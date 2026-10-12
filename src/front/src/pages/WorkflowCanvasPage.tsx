import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useStore,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { useAuth } from '@/auth/useAuth';
import { useTheme } from '@/theme/useTheme';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { workflowsService } from '@/services/workflowsService';
import { executionsService } from '@/services/executionsService';
import { Button } from '@/components/ui/button';
import AudioSeparationNode from '@/components/AudioSeparationNode';
import MergeNode from '@/components/MergeNode';
import { NodeSidePanel } from '@/components/NodeSidePanel';
import { MergeSidePanel } from '@/components/MergeSidePanel';
import { NodeCallbacksContext } from '@/components/nodes/NodeCallbacksContext';
import { AddNodeMenu } from '@/components/nodes/AddNodeMenu';
import { ValidationPill } from '@/components/nodes/ValidationPill';
import { ResultsToast } from '@/components/nodes/ResultsToast';
import type { AudioSeparationNodeData, MergeNodeData } from '@/components/nodes/nodeData';
import { outputColorHex } from '@/components/nodes/stemColors';
import { ExecutionDrawer } from '@/components/execution/ExecutionDrawer';
import { ExecuteTrimDialog } from '@/components/execution/ExecuteTrimDialog';
import { useExecutionStream } from '@/hooks/useExecutionStream';
import { applyNodeStatusEvent, upsertNodeExecution } from '@/lib/executionState';
import { getStemsForModel } from '@/lib/models';
import {
  DEFAULT_MODEL,
  collectRemoval,
  connectionError,
  defaultMergeLabel,
  edgeId,
  effectiveKeepState,
  getMergeGains,
  getModelName,
  inHandleId,
  inHandleIndex,
  incomingEdges,
  inputLabel,
  inputsFromEdges,
  keepSummary,
  parseConfig,
  removeGainAt,
  removeMergeInput,
  toggleKeep,
  validateWorkflow,
} from '@/lib/workflowGraph';
import { MERGE_OUTPUT, type MergeConfig, type NodeType } from '@/types/workflow';
import type { WorkflowNode } from '@/types/workflow';
import type {
  WorkflowExecution,
  WorkflowExecutionStatus,
  NodeExecution,
  NodeStatusEvent,
  ExecutionStatusEvent,
} from '@/types/execution';

// ── React Flow node types registry ────────────────────────────────────────────
const nodeTypes = { audioSeparation: AudioSeparationNode, merge: MergeNode };
const rfTypeFor = (t: NodeType) => (t === 'Merge' ? 'merge' : 'audioSeparation');

// ── Viewport: fit every node once they are measured, and again when nodes are added ────────────
const FIT_OPTIONS = { padding: 0.15, maxZoom: 1, minZoom: 0.2 } as const;

/**
 * The `fitView` prop alone fits too early here: React Flow mounts with no nodes (the graph is
 * seeded in an effect), so the first fit ran on unmeasured nodes and opened zoomed-in with cards
 * clipped. This waits for every node to be measured, then fits (capped at 100 %), and refits
 * whenever the node count grows (add node / server reload), not on deletes or drags.
 */
function FitViewOnChange() {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  // Read the count from the React Flow store (not page state): the store gets new nodes a commit
  // later, and only then does `initialized` drop until they are measured.
  const nodeCount = useStore((st) => st.nodes.length);
  const fittedCount = useRef(0);
  useEffect(() => {
    if (!initialized || nodeCount === 0) return;
    const first = fittedCount.current === 0;
    if (nodeCount > fittedCount.current) {
      // One frame later so freshly measured dimensions are in the store.
      const raf = requestAnimationFrame(() => void fitView({ ...FIT_OPTIONS, duration: first ? 0 : 250 }));
      fittedCount.current = nodeCount;
      return () => cancelAnimationFrame(raf);
    }
    fittedCount.current = nodeCount;
  }, [initialized, nodeCount, fitView]);
  return null;
}

// ── Dagre layout (left → right) ───────────────────────────────────────────────
const NODE_WIDTH = 288; // w-72
const NODE_HEIGHT = 220; // approximate card height

function layoutWithDagre(rfNodes: Node[], rfEdges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100 });

  rfNodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  rfEdges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return rfNodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } };
  });
}

// ── Convert WorkflowNode[] → RF nodes + edges ─────────────────────────────────
type NodeKind = WorkflowNode['nodeType'];

function makeEdge(source: string, sourceHandle: string, target: string, idx: number): Edge {
  return {
    id: edgeId(source, sourceHandle, target, idx),
    source,
    sourceHandle,
    target,
    targetHandle: inHandleId(idx),
    style: { stroke: outputColorHex(sourceHandle), strokeWidth: 2 },
  };
}

function makeNodeData(n: WorkflowNode, idx: number): Record<string, unknown> {
  const base = {
    nodeId: n.id,
    nodeType: n.nodeType,
    configJson: n.configJson,
    isRoot: n.inputs.length === 0,
    nodeIndex: idx,
    keptOutputs: n.keptOutputs,
  };
  // Merge's per-render fields (inputs, outputLabel) are derived in the page memo.
  return (n.nodeType === 'Merge' ? { ...base, inputs: [], outputLabel: 'Mix' } : base) as Record<string, unknown>;
}

function toRF(workflowNodes: WorkflowNode[]): { rfNodes: Node[]; rfEdges: Edge[] } {
  const rfNodes: Node[] = workflowNodes.map((n, idx) => ({
    id: n.id,
    type: rfTypeFor(n.nodeType),
    position: { x: 0, y: 0 }, // overwritten by dagre
    data: makeNodeData(n, idx),
  }));

  const rfEdges: Edge[] = workflowNodes.flatMap((n) =>
    n.inputs.map((i, idx) => makeEdge(i.sourceNodeId, i.sourceOutputName, n.id, idx)),
  );

  const laid = layoutWithDagre(rfNodes, rfEdges);
  return { rfNodes: laid, rfEdges };
}

// ── Convert RF state back → WorkflowNode[] (for validation + save) ────────────
function fromRF(rfNodes: Node[], rfEdges: Edge[]): WorkflowNode[] {
  return rfNodes.map((rfn, idx) => {
    const data = rfn.data as unknown as AudioSeparationNodeData | MergeNodeData;
    const nodeType: NodeKind = data.nodeType;
    // Drop keeps for outputs the node no longer produces (e.g. after a model change).
    const outputs = nodeType === 'Merge' ? [MERGE_OUTPUT as string] : getStemsForModel(getModelName(data));
    return {
      id: rfn.id,
      order: idx,
      nodeType,
      configJson: data.configJson,
      inputs: inputsFromEdges(rfEdges, rfn.id),
      keptOutputs: data.keptOutputs.filter((o) => outputs.includes(o)),
    };
  });
}

function nodeTypeMap(rfNodes: Node[]): Map<string, NodeKind> {
  return new Map(rfNodes.map((n) => [n.id, (n.data as unknown as { nodeType: NodeKind }).nodeType]));
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WorkflowCanvasPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showExecuteDialog, setShowExecuteDialog] = useState(false);
  const [saved, setSaved] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // React Flow state
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);

  // Handlers read the latest graph from refs (updated synchronously by commitGraph) so that
  // several React Flow change events in one tick (node delete + its edge deletes) compose
  // instead of acting on a stale snapshot.
  const rfNodesRef = useRef<Node[]>([]);
  const rfEdgesRef = useRef<Edge[]>([]);
  const commitGraph = useCallback((nodes: Node[], edges: Edge[]) => {
    rfNodesRef.current = nodes;
    rfEdgesRef.current = edges;
    setRfNodes(nodes);
    setRfEdges(edges);
  }, []);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [resultsToastFor, setResultsToastFor] = useState<string | null>(null);
  const watchedExecRef = useRef<string | null>(null);

  // ── Execution state ──────────────────────────────────────────────────────
  const [activeExecution, setActiveExecution] = useState<WorkflowExecution | null>(null);
  const [nodeExecutions, setNodeExecutions] = useState<NodeExecution[]>([]);
  const [execStatus, setExecStatus] = useState<WorkflowExecutionStatus | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);

  const isTerminal =
    execStatus === 'Completed' ||
    execStatus === 'Failed' ||
    execStatus === 'PartiallyFailed' ||
    execStatus === 'Cancelled';

  // ── SSE callbacks ────────────────────────────────────────────────────────
  const onNodeStatus = useCallback((ev: NodeStatusEvent) => {
    // Upsert: events for lazily-created downstream nodes / retries reference an id we have
    // not seen, so applyNodeStatusEvent places them by workflowNodeId instead of dropping them.
    setNodeExecutions((prev) => applyNodeStatusEvent(prev, ev));
  }, []);

  const onExecutionStatus = useCallback(
    (ev: ExecutionStatusEvent) => {
      setExecStatus(ev.status);
      // On a (near-)terminal status, reconcile local state with the authoritative server
      // record. This canvas keeps execution state in local useState (not a query), so we
      // refetch explicitly — backfilling any node executions, outputs or server timestamps
      // that were missed over the stream.
      const execId = activeExecution?.id;
      if (execId && (ev.status === 'Completed' || ev.status === 'PartiallyFailed' ||
                     ev.status === 'Failed' || ev.status === 'Cancelled')) {
        executionsService
          .get(execId)
          .then((fresh) => {
            setNodeExecutions(fresh.nodeExecutions);
            setExecStatus(fresh.status);
          })
          .catch(() => {});
      }
    },
    [activeExecution?.id],
  );

  const onSnapshot = useCallback((execution: WorkflowExecution) => {
    // Full reconciliation on (re)connect — covers events published before this subscriber
    // attached (initial load, or a reconnect after a dropped connection) that would otherwise
    // never reach the canvas.
    setNodeExecutions(execution.nodeExecutions);
    setExecStatus(execution.status);
  }, []);

  useExecutionStream({
    executionId: activeExecution?.id,
    onNodeStatus,
    onExecutionStatus,
    onSnapshot,
    enabled: !!activeExecution && !isTerminal && isAuthenticated,
  });

  // ── Derived workflow graph (validation, keep state, merge labels) ─────────
  const workflowNodes = useMemo(() => fromRF(rfNodes, rfEdges), [rfNodes, rfEdges]);
  const issues = useMemo(() => validateWorkflow(workflowNodes, getStemsForModel), [workflowNodes]);
  const keeps = useMemo(() => keepSummary(workflowNodes, getStemsForModel), [workflowNodes]);

  // ── Overlay derived + execution status onto React Flow nodes ─────────────
  const rfNodesWithExec = useMemo(() => {
    const issuesByNode = new Map<string, string[]>();
    for (const i of issues) issuesByNode.set(i.nodeId, [...(issuesByNode.get(i.nodeId) ?? []), i.message]);

    // Build a map: workflowNodeId → NodeExecution
    const neMap = new Map<string, NodeExecution>();
    for (const ne of nodeExecutions) neMap.set(ne.workflowNodeId, ne);

    // Build a set of completed workflow node IDs for parent checks
    const completedNodeIds = new Set<string>();
    for (const ne of nodeExecutions) {
      if (ne.status === 'Completed') completedNodeIds.add(ne.workflowNodeId);
    }

    return rfNodes.map((n, idx) => {
      const wn = workflowNodes[idx];
      const nodeData = n.data as unknown as AudioSeparationNodeData | MergeNodeData;
      const outputs = wn.nodeType === 'Merge' ? [MERGE_OUTPUT as string] : getStemsForModel(getModelName(wn));
      const keepStates = Object.fromEntries(outputs.map((o) => [o, effectiveKeepState(workflowNodes, wn.id, o)]));

      const derived: Record<string, unknown> = {
        nodeIndex: idx,
        isRoot: wn.inputs.length === 0,
        keepStates,
        issues: issuesByNode.get(wn.id),
      };
      if (wn.nodeType === 'Merge') {
        const gains = getMergeGains(wn.configJson, wn.inputs.length);
        derived.inputs = wn.inputs.map((inp, i) => ({ label: inputLabel(workflowNodes, inp), gainDb: gains[i] }));
        derived.outputLabel =
          parseConfig<MergeConfig>(wn.configJson).label?.trim() || defaultMergeLabel(wn, workflowNodes);
      }

      if (!activeExecution || nodeExecutions.length === 0) {
        return { ...n, data: { ...nodeData, ...derived } };
      }

      const ne = neMap.get(n.id);

      // A node can play if:
      // - It's a root node (no parent), OR all parent nodes (every input source) have completed
      // - AND it's not currently running/pending
      const parentCompleted = wn.inputs.every((i) => completedNodeIds.has(i.sourceNodeId));
      const notBusy = !ne || (ne.status !== 'Running' && ne.status !== 'Pending');
      const canPlay = parentCompleted && notBusy;

      if (!ne) {
        return {
          ...n,
          data: { ...nodeData, ...derived, execCanPlay: canPlay && wn.inputs.length === 0 },
        };
      }
      return {
        ...n,
        data: {
          ...nodeData,
          ...derived,
          execStatus: ne.status,
          execStartedAt: ne.startedAt,
          execCompletedAt: ne.completedAt,
          execErrorMessage: ne.errorMessage,
          execAttempt: ne.attempt,
          execOutputPaths: ne.outputArtifactPaths,
          execNodeExecutionId: ne.id,
          execCanPlay: canPlay,
        },
      };
    });
  }, [rfNodes, workflowNodes, issues, activeExecution, nodeExecutions]);

  // ── Auto-open Results when a run we watched finishes ─────────────────────
  // Only fires for a terminal transition observed live in this tab (never on page load of an
  // already-finished run): watchedExecRef is armed only after seeing a non-terminal status.
  useEffect(() => {
    if (!activeExecution || !execStatus) return;
    if (execStatus === 'Running' || execStatus === 'Pending') {
      watchedExecRef.current = activeExecution.id;
    } else if (
      (execStatus === 'Completed' || execStatus === 'PartiallyFailed') &&
      watchedExecRef.current === activeExecution.id
    ) {
      watchedExecRef.current = null;
      setResultsToastFor(activeExecution.id);
    }
  }, [execStatus, activeExecution]);

  const openResults = useCallback(() => {
    if (resultsToastFor) navigate(`/executions/${resultsToastFor}/results`);
  }, [navigate, resultsToastFor]);

  // ── Auth guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/login');
  }, [isAuthenticated, authLoading, navigate]);

  const { data: workflow, isLoading } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => workflowsService.get(id!),
    enabled: !!id && isAuthenticated,
  });

  // ── Load latest running execution for this workflow on mount ──────────────
  const { data: latestExecution } = useQuery({
    queryKey: ['latestExecution', id],
    queryFn: async () => {
      const all = await executionsService.list();
      const forWorkflow = all
        .filter((e) => e.workflowId === id && (e.status === 'Running' || e.status === 'Pending'))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return forWorkflow[0] ?? null;
    },
    enabled: !!id && isAuthenticated,
  });

  // Seed execution state from the latest running execution (once)
  const seededExecutionRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      latestExecution &&
      latestExecution.id !== seededExecutionRef.current &&
      !activeExecution
    ) {
      seededExecutionRef.current = latestExecution.id;
      setActiveExecution(latestExecution);
      setNodeExecutions(latestExecution.nodeExecutions);
      setExecStatus(latestExecution.status);
      setShowDrawer(true);
    }
  }, [latestExecution, activeExecution]);

  const patchNodeData = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    commitGraph(
      rfNodesRef.current.map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data as object), ...patch } } : n)),
      rfEdgesRef.current,
    );
    setSaved(false);
  }, [commitGraph]);

  const handleConfigChange = useCallback(
    (nodeId: string, configJson: string) => patchNodeData(nodeId, { configJson }),
    [patchNodeData],
  );

  const handleToggleKeep = useCallback((nodeId: string, output: string) => {
    const node = rfNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const kept = (node.data as unknown as { keptOutputs: string[] }).keptOutputs;
    patchNodeData(nodeId, { keptOutputs: toggleKeep(kept, output) });
  }, [patchNodeData]);

  // Remove inputs (by merge target + input index) from the current edge set, compacting the
  // remaining input indices and the Merge's gains (descending so earlier indices stay valid).
  const compactMergeInputs = useCallback(
    (edges: Edge[], nodes: Node[], removals: { target: string; idx: number }[]): { edges: Edge[]; nodes: Node[] } => {
      const sorted = [...removals].sort((a, b) => b.idx - a.idx);
      let nextEdges = edges;
      let nextNodes = nodes;
      for (const { target, idx } of sorted) {
        nextEdges = removeMergeInput(nextEdges, target, idx);
        nextNodes = nextNodes.map((n) => {
          if (n.id !== target) return n;
          const d = n.data as unknown as MergeNodeData;
          return { ...n, data: { ...d, configJson: removeGainAt(d.configJson, idx) } };
        });
      }
      return { edges: nextEdges, nodes: nextNodes };
    },
    [],
  );

  const handleRemoveInput = useCallback((nodeId: string, inputIndex: number) => {
    const target = incomingEdges(rfEdgesRef.current, nodeId).find((e) => inHandleIndex(e.targetHandle) === inputIndex);
    if (!target) return;
    const edges = rfEdgesRef.current.filter((e) => e.id !== target.id);
    const next = compactMergeInputs(edges, rfNodesRef.current, [{ target: nodeId, idx: inputIndex }]);
    commitGraph(next.nodes, next.edges);
    setSaved(false);
  }, [commitGraph, compactMergeInputs]);

  // Delete nodes. A Split fed by a removed node goes with it (as before); a Merge only loses
  // that input (and is removed itself once it has none left).
  const removeNodes = useCallback((ids: string[]) => {
    const nodes = rfNodesRef.current;
    const edges = rfEdgesRef.current;
    const removed = collectRemoval(nodeTypeMap(nodes), edges, ids);
    if (removed.size === 0) return;

    const kept = edges.filter((e) => !removed.has(e.source) && !removed.has(e.target));
    const lost = edges
      .filter((e) => removed.has(e.source) && !removed.has(e.target))
      .map((e) => ({ target: e.target, idx: inHandleIndex(e.targetHandle) }));
    const next = compactMergeInputs(kept, nodes.filter((n) => !removed.has(n.id)), lost);
    commitGraph(next.nodes, next.edges);
    setSelectedNodeId((prev) => (prev && removed.has(prev) ? null : prev));
    setSaved(false);
  }, [commitGraph, compactMergeInputs]);

  const handleRemoveNode = useCallback((nodeId: string) => removeNodes([nodeId]), [removeNodes]);

  // Seed RF state once per workflow id. Keyed on a ref (not rfNodes.length) so that emptying
  // the canvas without saving does not re-fire this and resurrect the deleted nodes from the
  // still-cached workflow query.
  const seededWorkflowRef = useRef<string | null>(null);
  useEffect(() => {
    if (workflow && seededWorkflowRef.current !== workflow.id) {
      seededWorkflowRef.current = workflow.id;
      const { rfNodes: n, rfEdges: e } = toRF(workflow.nodes);
      commitGraph(n, e);
    }
  }, [workflow, commitGraph]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const removedIds = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      const rest = changes.filter((c) => c.type !== 'remove');
      if (rest.length > 0) commitGraph(applyNodeChanges(rest, rfNodesRef.current), rfEdgesRef.current);
      if (removedIds.length > 0) removeNodes(removedIds);
    },
    [commitGraph, removeNodes],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const current = rfEdgesRef.current;
      // Ignore removals of edges already gone (a node delete also emits its edge removals).
      const removals = changes
        .filter((c) => c.type === 'remove')
        .map((c) => current.find((e) => e.id === c.id))
        .filter((e): e is Edge => !!e);
      const applied = applyEdgeChanges(
        changes.filter((c) => c.type !== 'remove' || current.some((e) => e.id === c.id)),
        current,
      );
      const types = nodeTypeMap(rfNodesRef.current);
      const mergeRemovals = removals
        .filter((e) => types.get(e.target) === 'Merge')
        .map((e) => ({ target: e.target, idx: inHandleIndex(e.targetHandle) }));
      const next = compactMergeInputs(applied, rfNodesRef.current, mergeRemovals);
      commitGraph(next.nodes, next.edges);
      if (changes.some((c) => c.type === 'remove')) setSaved(false);
    },
    [commitGraph, compactMergeInputs],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) =>
      connectionError(nodeTypeMap(rfNodesRef.current), rfEdgesRef.current, {
        source: c.source,
        sourceHandle: c.sourceHandle,
        target: c.target,
        targetHandle: c.targetHandle,
      }) === null,
    [],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const types = nodeTypeMap(rfNodesRef.current);
      const err = connectionError(types, rfEdgesRef.current, connection);
      if (err) {
        setConnectError(err);
        return;
      }
      const incoming = incomingEdges(rfEdgesRef.current, connection.target);
      let idx = 0;
      let drop: Edge[] = incoming; // Split: a new connection replaces its single input
      if (types.get(connection.target) === 'Merge') {
        // Dropping on the empty slot appends; dropping on an occupied slot replaces that input.
        idx = Math.min(inHandleIndex(connection.targetHandle), incoming.length);
        drop = incoming.filter((e) => inHandleIndex(e.targetHandle) === idx);
      }
      const dropIds = new Set(drop.map((e) => e.id));
      const edge = makeEdge(connection.source, connection.sourceHandle ?? '', connection.target, idx);
      commitGraph(rfNodesRef.current, [...rfEdgesRef.current.filter((e) => !dropIds.has(e.id)), edge]);
      setSaved(false);
    },
    [commitGraph],
  );

  const handleAddNode = useCallback((type: NodeType) => {
    const nodes = rfNodesRef.current;
    const wn: WorkflowNode = {
      id: crypto.randomUUID(),
      order: nodes.length,
      nodeType: type,
      configJson:
        type === 'Merge'
          ? JSON.stringify({ levelMode: 'preventClipping', inputGainsDb: [] } satisfies MergeConfig)
          : JSON.stringify({ modelName: DEFAULT_MODEL }),
      inputs: [],
      keptOutputs: [],
    };
    const maxX = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.x)) : -420;
    const newNode: Node = {
      id: wn.id,
      type: rfTypeFor(type),
      position: { x: maxX + 420, y: 80 },
      data: makeNodeData(wn, nodes.length),
    };
    commitGraph([...nodes, newNode], rfEdgesRef.current);
    setSaved(false);
  }, [commitGraph]);

  // S / G add a Split / Merge while the canvas has focus (not while typing).
  const onCanvasKeyDown = useCallback((e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === 's' || e.key === 'S') handleAddNode('AudioSeparation');
    else if (e.key === 'g' || e.key === 'G') handleAddNode('Merge');
  }, [handleAddNode]);

  // Transient connection-rejection notice.
  useEffect(() => {
    if (!connectError) return;
    const t = setTimeout(() => setConnectError(null), 3000);
    return () => clearTimeout(t);
  }, [connectError]);

  const saveMutation = useMutation({
    mutationFn: () =>
      workflowsService.update(id!, {
        name: workflow!.name,
        // Client-generated GUIDs are sent as-is, so edges between unsaved nodes round-trip.
        nodes: workflowNodes,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['workflow', id], updated);
      const { rfNodes: n, rfEdges: e } = toRF(updated.nodes);
      commitGraph(n, e);
      setSaved(true);
    },
  });

  // ── Execute: stay on canvas, populate execution state ────────────────────
  const executeMutation = useMutation({
    mutationFn: async (args: { fileId: string; trimStart?: number; trimEnd?: number }) => {
      if (!saved) await saveMutation.mutateAsync();
      return executionsService.start(id!, args.fileId, args.trimStart, args.trimEnd);
    },
    onSuccess: (execution) => {
      setActiveExecution(execution);
      setNodeExecutions(execution.nodeExecutions);
      setExecStatus(execution.status);
      setShowDrawer(true);
      setShowExecuteDialog(false);
    },
  });

  // ── Re-run: same file and trim range, new execution ─────────────────────
  const reRunMutation = useMutation({
    mutationFn: async () => {
      if (!activeExecution) throw new Error('No execution to re-run');
      if (!saved) await saveMutation.mutateAsync();
      return executionsService.start(
        id!,
        activeExecution.inputFile.id,
        activeExecution.trimStartSeconds,
        activeExecution.trimEndSeconds,
      );
    },
    onSuccess: (execution) => {
      setActiveExecution(execution);
      setNodeExecutions(execution.nodeExecutions);
      setExecStatus(execution.status);
    },
  });

  // ── Cancel the active execution ──────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: () => executionsService.cancel(activeExecution!.id),
    onSuccess: (updated) => {
      setActiveExecution(updated);
      setNodeExecutions(updated.nodeExecutions);
      setExecStatus(updated.status);
    },
  });

  // ── Retry a specific failed node ─────────────────────────────────────────
  const retryMutation = useMutation({
    mutationFn: ({ nodeExecutionId }: { nodeExecutionId: string }) =>
      executionsService.retry(activeExecution!.id, nodeExecutionId),
    onSuccess: (updated) => {
      // Retry returns a NEW node execution (new id, attempt+1) for the same workflow node;
      // replace by workflowNodeId so the new attempt supersedes the old failed row and its
      // subsequent SSE events (keyed on the new id) land on it.
      setNodeExecutions((prev) => upsertNodeExecution(prev, updated));
      // The retry endpoint moves the execution back to Running server-side. Reset the local
      // status so it's no longer terminal, which re-enables the SSE stream — otherwise a retry
      // triggered from a terminal (Failed/PartiallyFailed) run would complete on the server but
      // never stream its progress back to the canvas.
      setExecStatus('Running');
    },
  });

  // ── Play node: retry failed, or re-run from this node ────────────────────
  const handlePlayNode = useCallback(
    (workflowNodeId: string) => {
      // No active execution → open execute dialog to start a fresh run
      if (!activeExecution) {
        setShowExecuteDialog(true);
        return;
      }

      // Find the node execution for this workflow node
      const ne = nodeExecutions.find((n) => n.workflowNodeId === workflowNodeId);

      if (ne && ne.status === 'Failed') {
        // Retry the failed node via API
        retryMutation.mutate({ nodeExecutionId: ne.id });
      } else {
        // Re-run: start a brand-new execution with the same input file
        // This re-runs the entire workflow from scratch (backend limitation)
        reRunMutation.mutate();
      }
    },
    [activeExecution, nodeExecutions, retryMutation, reRunMutation],
  );

  if (authLoading || isLoading || !workflow) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const currentExecStatus = execStatus ?? activeExecution?.status ?? null;
  const isRunning = currentExecStatus === 'Running' || currentExecStatus === 'Pending';

  // The canvas always renders the LATEST workflow version, but an execution stays pinned to
  // whichever version was live when it started. Editing + saving after a run bumps the version
  // (new node ids), so the overlay above is keyed against a version that no longer matches what's
  // on screen — node labels/models are still correct (resolved server-side from the pinned
  // version), but new nodes never show a status and removed nodes surface as orphan drawer rows.
  const versionDrift =
    !!activeExecution && !isRunning && activeExecution.workflowVersionId !== workflow.versionId;

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b bg-background shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 hover:opacity-80 shrink-0"
          >
            <span className="text-xl">🎵</span>
            <span className="font-semibold hidden sm:block">Fluent Audio Split</span>
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium truncate flex-1">{workflow.name}</span>
          {!saved && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium shrink-0">● Unsaved</span>
          )}
          {/* Keep summary + validation */}
          <span
            className="text-xs font-medium text-amber-700 dark:text-amber-300 shrink-0 hidden md:inline"
            title={keeps.items.length ? keeps.items.map((i) => `${i.nodeLabel} · ${i.output}`).join('\n') : 'Nothing kept yet'}
          >
            📌 {keeps.mode === 'explicit' ? `${keeps.items.length} kept` : `auto: ${keeps.items.length} terminal`}
          </span>
          <ValidationPill issues={issues} onSelectNode={setSelectedNodeId} />
          {/* Running indicator */}
          {isRunning && (
            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium shrink-0 animate-pulse">● Running</span>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <AddNodeMenu
              onAdd={handleAddNode}
              disabled={isRunning}
              disabledTitle="Editing is disabled while an execution is running"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || saved || isRunning || issues.length > 0}
              title={
                isRunning
                  ? 'Saving is disabled while an execution is running'
                  : issues.length > 0
                    ? `Fix before saving:\n${issues.map((i) => i.message).join('\n')}`
                    : undefined
              }
            >
              {saveMutation.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
            </Button>
            <Button
              size="sm"
              onClick={() => setShowExecuteDialog(true)}
              disabled={isRunning || issues.length > 0}
              title={issues.length > 0 ? `Fix before executing:\n${issues.map((i) => i.message).join('\n')}` : undefined}
            >
              ⚡ Execute
            </Button>
            {isRunning && activeExecution && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? 'Cancelling…' : '⨯ Cancel'}
              </Button>
            )}
            {activeExecution && !isRunning && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => reRunMutation.mutate()}
                disabled={reRunMutation.isPending || issues.length > 0}
                title={issues.length > 0 ? `Fix before executing:\n${issues.map((i) => i.message).join('\n')}` : undefined}
              >
                {reRunMutation.isPending ? 'Starting…' : '↻ Re-run'}
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
            ← Back
          </Button>
          <ThemeToggle className="shrink-0" />
        </div>
      </header>

      {/* Version drift notice — the overlay below reflects the version the execution ran
          against, not the (edited-since) version currently on the canvas. */}
      {versionDrift && (
        <div className="shrink-0 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 px-4 py-1.5 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
          <span>⚠</span>
          <span>
            Workflow changed since this execution ran — node status/labels below reflect the
            version it actually ran against, not your current edits.
          </span>
        </div>
      )}

      {/* Canvas + Side Panel */}
      <main className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>
        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden">
          <NodeCallbacksContext.Provider
            value={{
              onConfigChange: handleConfigChange,
              onRemove: handleRemoveNode,
              onPlayNode: handlePlayNode,
              onToggleKeep: handleToggleKeep,
              onRemoveInput: handleRemoveInput,
            }}
          >
            <div style={{ position: 'absolute', inset: 0 }} onKeyDown={isRunning ? undefined : onCanvasKeyDown}>
            <ReactFlow
              nodes={rfNodesWithExec}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={(_evt, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              colorMode={theme}
              minZoom={FIT_OPTIONS.minZoom}
              defaultEdgeOptions={{ style: { stroke: '#8b5cf6', strokeWidth: 2 } }}
              proOptions={{ hideAttribution: true }}
            >
              <FitViewOnChange />
              <Background gap={28} size={1} />
              <Controls fitViewOptions={FIT_OPTIONS} />
              <MiniMap
                nodeColor={(n) => ((n.data as { nodeType?: string }).nodeType === 'Merge' ? '#0f766e' : '#7c3aed')}
                nodeBorderRadius={6}
                pannable
                zoomable
                ariaLabel="Workflow overview"
              />
            </ReactFlow>
            </div>
          </NodeCallbacksContext.Provider>

          {/* Empty state overlay */}
          {rfNodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-sm text-muted-foreground">No nodes yet.</p>
              <p className="text-xs mt-1 text-muted-foreground">Use "+ Add Node" in the header (or press S / G) to get started.</p>
            </div>
          )}
        </div>

        {/* Right side panel — shown when a node is selected */}
        {selectedNodeId && (() => {
          const selIdx = rfNodesWithExec.findIndex((n) => n.id === selectedNodeId);
          if (selIdx < 0) return null;
          const selNode = rfNodesWithExec[selIdx];
          const nodeData = selNode.data as unknown as AudioSeparationNodeData | MergeNodeData;
          if (nodeData.nodeType === 'Merge') {
            const md = nodeData as MergeNodeData;
            return (
              <MergeSidePanel
                key={selectedNodeId}
                nodeId={selectedNodeId}
                nodeIndex={md.nodeIndex}
                configJson={md.configJson}
                inputLabels={md.inputs.map((i) => i.label)}
                defaultLabel={defaultMergeLabel(workflowNodes[selIdx], workflowNodes)}
                onConfigChange={handleConfigChange}
                onRemoveInput={handleRemoveInput}
                onClose={() => setSelectedNodeId(null)}
              />
            );
          }
          return (
            <NodeSidePanel
              key={selectedNodeId}
              nodeId={selectedNodeId}
              nodeIndex={nodeData.nodeIndex}
              configJson={nodeData.configJson}
              outputs={getStemsForModel(getModelName(nodeData)).map((name) => ({
                name,
                state: nodeData.keepStates?.[name] ?? 'none',
              }))}
              onToggleKeep={handleToggleKeep}
              onConfigChange={handleConfigChange}
              onClose={() => setSelectedNodeId(null)}
            />
          );
        })()}
      </main>

      {/* Execution Drawer */}
      {showDrawer && activeExecution && (
        <ExecutionDrawer
          executionId={activeExecution.id}
          nodeExecutions={nodeExecutions}
          workflowNodes={workflow.nodes}
          executionStatus={currentExecStatus}
          executionInputFileName={activeExecution.inputFile.originalFileName}
          executionCreatedAt={activeExecution.createdAt}
          onRetryNode={(nodeExecutionId) => retryMutation.mutate({ nodeExecutionId })}
          isRetrying={retryMutation.isPending}
          onReRun={() => reRunMutation.mutate()}
          onClose={() => setShowDrawer(false)}
        />
      )}

      {/* Connection rejected */}
      {connectError && (
        <div role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800/60 px-4 py-2 text-amber-800 dark:text-amber-200 text-sm shadow-md z-50">
          {connectError}
        </div>
      )}

      {/* Auto-open Results */}
      {resultsToastFor && resultsToastFor === activeExecution?.id && (execStatus === 'Completed' || execStatus === 'PartiallyFailed') && (
        <ResultsToast onOpen={openResults} onStay={() => setResultsToastFor(null)} />
      )}

      {/* Save error */}
      {saveMutation.isError && (
        <div className="fixed bottom-4 right-4 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800/60 px-4 py-3 text-red-700 dark:text-red-300 text-sm shadow-md z-50">
          Save failed: {(saveMutation.error as Error).message}
        </div>
      )}

      {/* Execute error */}
      {executeMutation.isError && (
        <div className="fixed bottom-4 right-4 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800/60 px-4 py-3 text-red-700 dark:text-red-300 text-sm shadow-md z-50">
          Execute failed: {(executeMutation.error as Error).message}
        </div>
      )}

      {/* Execute Dialog */}
      {showExecuteDialog && (
        <ExecuteTrimDialog
          isPending={executeMutation.isPending}
          onExecute={(args) => executeMutation.mutate(args)}
          onClose={() => setShowExecuteDialog(false)}
        />
      )}
    </div>
  );
}
