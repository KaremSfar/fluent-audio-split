import { useEffect, useState, useCallback, useRef } from 'react';
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
import { filesService } from '@/services/filesService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import AudioSeparationNode, {
  NodeCallbacksContext,
  type AudioSeparationNodeData,
} from '@/components/AudioSeparationNode';
import type { WorkflowNode } from '@/types/workflow';
import type { FileRecord } from '@/types/file';

// ── React Flow node types registry ────────────────────────────────────────────
const nodeTypes = { audioSeparation: AudioSeparationNode };

// ── Execute Dialog ─────────────────────────────────────────────────────────────
function ExecuteDialog({
  files,
  onExecute,
  onClose,
  isPending,
}: {
  files: FileRecord[];
  onExecute: (fileId: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const navigate = useNavigate();
  const [selectedFileId, setSelectedFileId] = useState(files[0]?.id ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-sm mx-4">
        <CardHeader>
          <CardTitle>Run Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Select audio file</label>
            {files.length === 0 ? (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>No files uploaded yet.</p>
                <Button variant="outline" size="sm" onClick={() => navigate('/files')}>
                  Upload a file →
                </Button>
              </div>
            ) : (
              <select
                value={selectedFileId}
                onChange={(e) => setSelectedFileId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {files.map((f) => (
                  <option key={f.id} value={f.id}>{f.originalFileName}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button
              disabled={!selectedFileId || isPending}
              onClick={() => onExecute(selectedFileId)}
            >
              {isPending ? 'Starting…' : '⚡ Run'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
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

  // React Flow state
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);

  // Keep a ref to original WorkflowNode[] so we can read nodeType on save
  const originalNodesRef = useRef<WorkflowNode[]>([]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/login');
  }, [isAuthenticated, authLoading, navigate]);

  const { data: workflow, isLoading } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => workflowsService.get(id!),
    enabled: !!id && isAuthenticated,
  });

  const { data: files = [] } = useQuery({
    queryKey: ['files'],
    queryFn: filesService.list,
    enabled: isAuthenticated,
  });

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

  // Seed RF state once workflow loads
  useEffect(() => {
    if (workflow && rfNodes.length === 0) {
      originalNodesRef.current = workflow.nodes;
      const { rfNodes: n, rfEdges: e } = toRF(workflow.nodes);
      setRfNodes(n);
      setRfEdges(e);
    }
  }, [workflow, rfNodes.length]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setRfNodes((nds) => applyNodeChanges(changes, nds)),
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

  const executeMutation = useMutation({
    mutationFn: async (fileId: string) => {
      if (!saved) await saveMutation.mutateAsync();
      return executionsService.start(id!, fileId);
    },
    onSuccess: (execution) => navigate(`/executions/${execution.id}`),
  });

  if (authLoading || isLoading || !workflow) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

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
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddNode}
            >
              + Add Node
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || saved}
            >
              {saveMutation.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
            </Button>
            <Button size="sm" onClick={() => setShowExecuteDialog(true)}>
              ⚡ Execute
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
            ← Back
          </Button>
        </div>
      </header>

      {/* Canvas */}
      <main className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
        <NodeCallbacksContext.Provider value={{ onConfigChange: handleConfigChange, onRemove: handleRemoveNode }}>
          <div style={{ position: 'absolute', inset: 0 }}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
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
      </main>

      {/* Save error */}
      {saveMutation.isError && (
        <div className="fixed bottom-4 right-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm shadow-md z-50">
          Save failed: {(saveMutation.error as Error).message}
        </div>
      )}

      {/* Execute Dialog */}
      {showExecuteDialog && (
        <ExecuteDialog
          files={files}
          isPending={executeMutation.isPending}
          onExecute={(fileId) => executeMutation.mutate(fileId)}
          onClose={() => setShowExecuteDialog(false)}
        />
      )}
    </div>
  );
}
