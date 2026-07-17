import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
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
import { workflowsService } from '@/services/workflowsService';
import { executionsService } from '@/services/executionsService';
import { Button } from '@/components/ui/button';
import AudioSeparationNode, {
  NodeCallbacksContext,
  type AudioSeparationNodeData,
} from '@/components/AudioSeparationNode';
import { NodeSidePanel } from '@/components/NodeSidePanel';
import { ExecutionDrawer } from '@/components/execution/ExecutionDrawer';
import { ExecuteTrimDialog } from '@/components/execution/ExecuteTrimDialog';
import { useExecutionStream } from '@/hooks/useExecutionStream';
import { applyNodeStatusEvent, upsertNodeExecution } from '@/lib/executionState';
import type { WorkflowNode } from '@/types/workflow';
import type {
  WorkflowExecution,
  WorkflowExecutionStatus,
  NodeExecution,
  NodeStatusEvent,
  ExecutionStatusEvent,
} from '@/types/execution';

// ── React Flow node types registry ────────────────────────────────────────────
const nodeTypes = { audioSeparation: AudioSeparationNode };

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
function toRF(workflowNodes: WorkflowNode[]): { rfNodes: Node[]; rfEdges: Edge[] } {
  const rfNodes: Node[] = workflowNodes.map((n, idx) => {
    const data: AudioSeparationNodeData = {
      nodeId: n.id,
      configJson: n.configJson,
      isRoot: n.sourceNodeId === null,
      nodeIndex: idx,
    };

    return {
      id: n.id,
      type: 'audioSeparation',
      position: { x: 0, y: 0 }, // overwritten by dagre
      data: data as unknown as Record<string, unknown>,
    };
  });

  const rfEdges: Edge[] = workflowNodes
    .filter((n) => n.sourceNodeId && n.sourceOutputName)
    .map((n) => ({
      id: `e-${n.sourceNodeId}-${n.sourceOutputName}-${n.id}`,
      source: n.sourceNodeId!,
      target: n.id,
      sourceHandle: n.sourceOutputName!,
      targetHandle: 'input',
      style: { stroke: '#8b5cf6', strokeWidth: 2 },
    }));

  const laid = layoutWithDagre(rfNodes, rfEdges);
  return { rfNodes: laid, rfEdges };
}

// ── Convert RF state back → WorkflowNode[] (for save) ─────────────────────────
function fromRF(rfNodes: Node[], rfEdges: Edge[], original: WorkflowNode[]): WorkflowNode[] {
  const edgesByTarget = new Map<string, Edge>();
  rfEdges.forEach((e) => edgesByTarget.set(e.target, e));

  return rfNodes.map((rfn, idx) => {
    const orig = original.find((o) => o.id === rfn.id);
    const data = rfn.data as unknown as AudioSeparationNodeData;
    const inEdge = edgesByTarget.get(rfn.id);
    return {
      id: rfn.id,
      order: idx,
      nodeType: orig?.nodeType ?? 'AudioSeparation',
      configJson: data.configJson as unknown as string,
      sourceNodeId: inEdge ? inEdge.source : null,
      sourceOutputName: inEdge ? (inEdge.sourceHandle ?? null) : null,
    };
  });
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WorkflowCanvasPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showExecuteDialog, setShowExecuteDialog] = useState(false);
  const [saved, setSaved] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // React Flow state
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);

  // Keep a ref to original WorkflowNode[] so we can read nodeType on save
  const originalNodesRef = useRef<WorkflowNode[]>([]);

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

  useExecutionStream({
    executionId: activeExecution?.id,
    onNodeStatus,
    onExecutionStatus,
    enabled: !!activeExecution && !isTerminal && isAuthenticated,
  });

  // ── Overlay execution status onto React Flow nodes ───────────────────────
  const rfNodesWithExec = useMemo(() => {
    if (!activeExecution || nodeExecutions.length === 0) return rfNodes;

    // Build a map: workflowNodeId → NodeExecution
    const neMap = new Map<string, NodeExecution>();
    for (const ne of nodeExecutions) neMap.set(ne.workflowNodeId, ne);

    // Build a set of completed workflow node IDs for parent checks
    const completedNodeIds = new Set<string>();
    for (const ne of nodeExecutions) {
      if (ne.status === 'Completed') completedNodeIds.add(ne.workflowNodeId);
    }

    return rfNodes.map((n) => {
      const ne = neMap.get(n.id);
      const nodeData = n.data as unknown as AudioSeparationNodeData;

      // A node can play if:
      // - It's a root node (no parent), OR all parent nodes have completed
      // - AND it's not currently running/pending
      const parentEdge = rfEdges.find((e) => e.target === n.id);
      const parentCompleted = !parentEdge || completedNodeIds.has(parentEdge.source);
      const notBusy = !ne || (ne.status !== 'Running' && ne.status !== 'Pending');
      const canPlay = parentCompleted && notBusy;

      if (!ne) {
        return {
          ...n,
          data: { ...(n.data as object), execCanPlay: canPlay && nodeData.isRoot },
        };
      }
      return {
        ...n,
        data: {
          ...(n.data as object),
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
  }, [rfNodes, rfEdges, activeExecution, nodeExecutions]);

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

  const handleConfigChange = useCallback((nodeId: string, configJson: string) => {
    setRfNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...(n.data as object), configJson } }
          : n,
      ),
    );
    setSaved(false);
  }, []);

  const handleRemoveNode = useCallback((nodeId: string) => {
    // Collect node + all descendants using the current edges snapshot
    const getDescendants = (startId: string, edges: Edge[]): Set<string> => {
      const result = new Set<string>();
      const queue = [startId];
      while (queue.length) {
        const cur = queue.shift()!;
        result.add(cur);
        edges.filter((e: Edge) => e.source === cur).forEach((e: Edge) => queue.push(e.target));
      }
      return result;
    };

    const descendants = getDescendants(nodeId, rfEdgesRef.current);
    setRfNodes((prev) => prev.filter((n) => !descendants.has(n.id)));
    setRfEdges((prev) => prev.filter((e: Edge) => !descendants.has(e.source) && !descendants.has(e.target)));
    setSaved(false);
  }, []);

  // Keep a ref to current edges so handleRemoveNode can read them
  const rfEdgesRef = useRef<Edge[]>([]);
  useEffect(() => { rfEdgesRef.current = rfEdges; }, [rfEdges]);

  // Seed RF state once per workflow id. Keyed on a ref (not rfNodes.length) so that emptying
  // the canvas without saving does not re-fire this and resurrect the deleted nodes from the
  // still-cached workflow query.
  const seededWorkflowRef = useRef<string | null>(null);
  useEffect(() => {
    if (workflow && seededWorkflowRef.current !== workflow.id) {
      seededWorkflowRef.current = workflow.id;
      originalNodesRef.current = workflow.nodes;
      const { rfNodes: n, rfEdges: e } = toRF(workflow.nodes);
      setRfNodes(n);
      setRfEdges(e);
    }
  }, [workflow]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setRfNodes((nds) => applyNodeChanges(changes, nds));
      const removals = changes.filter((c) => c.type === 'remove');
      if (removals.length > 0) {
        const removedIds = new Set(removals.map((c) => c.id));
        setRfEdges((eds) =>
          eds.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)),
        );
        setSelectedNodeId((prev) => {
          return prev && removedIds.has(prev) ? null : prev;
        });
        setSaved(false);
      }
    },
    [],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setRfEdges((eds) => applyEdgeChanges(changes, eds));
      setSaved(false);
    },
    [],
  );
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setRfEdges((eds) => {
        // Remove any existing edge to the same target handle, then add new one
        const filtered = eds.filter(
          (e) => !(e.target === connection.target && e.targetHandle === connection.targetHandle),
        );
        const newEdge: Edge = {
          ...connection,
          id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}`,
          style: { stroke: '#8b5cf6', strokeWidth: 2 },
        };
        return addEdge(newEdge, filtered);
      });
      // Mark target node as non-root once it has an incoming connection
      setRfNodes((nds) =>
        nds.map((n) =>
          n.id === connection.target ? { ...n, data: { ...n.data, isRoot: false } } : n,
        ),
      );
      setSaved(false);
    },
    [],
  );

  const handleAddNode = useCallback(() => {
    const newId = `new:${crypto.randomUUID()}`;
    const data: AudioSeparationNodeData = {
      nodeId: newId,
      configJson: JSON.stringify({ modelName: 'htdemucs_ft.yaml' }),
      isRoot: true,
      nodeIndex: rfNodes.length,
    };
    const maxX = rfNodes.length > 0 ? Math.max(...rfNodes.map((n) => n.position.x)) : -420;
    const newNode: Node = {
      id: newId,
      type: 'audioSeparation',
      position: { x: maxX + 420, y: 80 },
      data: data as unknown as Record<string, unknown>,
    };
    setRfNodes((prev) => [...prev, newNode]);
    setSaved(false);
  }, [rfNodes]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const workflowNodes = fromRF(rfNodes, rfEdges, originalNodesRef.current);
      const isNew = (nodeId: string) => nodeId.startsWith('new:');
      return workflowsService.update(id!, {
        name: workflow!.name,
        nodes: workflowNodes.map((n, i) => ({
          id: isNew(n.id) ? undefined : n.id,
          order: i,
          nodeType: n.nodeType,
          configJson: n.configJson,
          sourceNodeId: n.sourceNodeId && isNew(n.sourceNodeId) ? null : n.sourceNodeId,
          sourceOutputName: n.sourceOutputName,
        })),
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['workflow', id], updated);
      originalNodesRef.current = updated.nodes;
      const { rfNodes: n, rfEdges: e } = toRF(updated.nodes);
      setRfNodes(n);
      setRfEdges(e);
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

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b shrink-0">
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
            <span className="text-xs text-amber-600 font-medium shrink-0">● Unsaved</span>
          )}
          {/* Running indicator */}
          {isRunning && (
            <span className="text-xs text-blue-600 font-medium shrink-0 animate-pulse">● Running</span>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddNode}
              disabled={isRunning}
              title={isRunning ? 'Editing is disabled while an execution is running' : undefined}
            >
              + Add Node
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || saved || isRunning}
              title={isRunning ? 'Saving is disabled while an execution is running' : undefined}
            >
              {saveMutation.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
            </Button>
            <Button
              size="sm"
              onClick={() => setShowExecuteDialog(true)}
              disabled={isRunning}
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
                disabled={reRunMutation.isPending}
              >
                {reRunMutation.isPending ? 'Starting…' : '↻ Re-run'}
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
            ← Back
          </Button>
        </div>
      </header>

      {/* Canvas + Side Panel */}
      <main className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>
        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden">
          <NodeCallbacksContext.Provider value={{ onConfigChange: handleConfigChange, onRemove: handleRemoveNode, onPlayNode: handlePlayNode }}>
            <div style={{ position: 'absolute', inset: 0 }}>
            <ReactFlow
              nodes={rfNodesWithExec}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_evt, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              defaultEdgeOptions={{ style: { stroke: '#8b5cf6', strokeWidth: 2 } }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#d1d5db" gap={28} size={1} />
              <Controls />
              <MiniMap nodeColor="#8b5cf6" maskColor="rgba(0,0,0,0.05)" />
            </ReactFlow>
            </div>
          </NodeCallbacksContext.Provider>

          {/* Empty state overlay */}
          {rfNodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-sm text-muted-foreground">No nodes yet.</p>
              <p className="text-xs mt-1 text-muted-foreground">Click "+ Add Node" in the header to get started.</p>
            </div>
          )}
        </div>

        {/* Right side panel — shown when a node is selected */}
        {selectedNodeId && (() => {
          const selNode = rfNodes.find((n) => n.id === selectedNodeId);
          if (!selNode) return null;
          const nodeData = selNode.data as unknown as AudioSeparationNodeData;
          return (
            <NodeSidePanel
              key={selectedNodeId}
              nodeId={selectedNodeId}
              nodeIndex={nodeData.nodeIndex as number}
              configJson={nodeData.configJson as unknown as string}
              onConfigChange={handleConfigChange}
              onClose={() => setSelectedNodeId(null)}
            />
          );
        })()}
      </main>

      {/* Execution Drawer */}
      {showDrawer && activeExecution && (
        <ExecutionDrawer
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

      {/* Save error */}
      {saveMutation.isError && (
        <div className="fixed bottom-4 right-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm shadow-md z-50">
          Save failed: {(saveMutation.error as Error).message}
        </div>
      )}

      {/* Execute error */}
      {executeMutation.isError && (
        <div className="fixed bottom-4 right-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm shadow-md z-50">
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
