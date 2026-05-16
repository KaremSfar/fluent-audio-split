import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { workflowsService } from '@/services/workflowsService';
import { executionsService } from '@/services/executionsService';
import { filesService } from '@/services/filesService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MODEL_DEFINITIONS, getStemsForModel, STEM_COLORS } from '@/lib/models';
import type { WorkflowNode } from '@/types/workflow';
import type { FileRecord } from '@/types/file';

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

// ── Node Card ─────────────────────────────────────────────────────────────────
function AudioSeparationNodeCard({
  node,
  index,
  nodes,
  onChange,
  onAddChild,
  onRemove,
}: {
  node: WorkflowNode;
  index: number;
  nodes: WorkflowNode[];
  onChange: (nodeId: string, configJson: string) => void;
  onAddChild: (parentNodeId: string, stemName: string) => void;
  onRemove: (nodeId: string) => void;
}) {
  const config = (() => { try { return JSON.parse(node.configJson); } catch { return {}; } })();
  const modelName: string = config.modelName ?? 'htdemucs_ft.yaml';
  const stems = getStemsForModel(modelName);
  const isRoot = node.sourceNodeId === null;

  const parentNode = node.sourceNodeId
    ? nodes.find((n) => n.id === node.sourceNodeId)
    : null;
  const parentConfig = parentNode
    ? (() => { try { return JSON.parse(parentNode.configJson); } catch { return {}; } })()
    : null;

  return (
    <div className="w-80 rounded-xl border-2 border-violet-400 bg-background shadow-lg">
      {/* Header */}
      <div className="bg-violet-500 text-white rounded-t-xl px-4 py-2 flex items-center gap-2">
        <span className="text-lg">🎛️</span>
        <span className="font-semibold text-sm">Audio Separation</span>
        <Badge variant="secondary" className="ml-auto text-xs bg-violet-300 text-violet-900">
          Node {index + 1}
        </Badge>
        {!isRoot && (
          <button
            onClick={() => onRemove(node.id)}
            className="ml-1 text-violet-200 hover:text-white text-xs"
            title="Remove node"
          >
            ✕
          </button>
        )}
      </div>

      {/* Input indicator */}
      <div className="px-4 pt-3 pb-1">
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
          {isRoot
            ? 'Input: uploaded audio file'
            : (
              <span>
                Input: <span className="font-medium text-violet-600">{node.sourceOutputName}</span>
                {' '}from Node {(nodes.findIndex(n => n.id === node.sourceNodeId) + 1)}
                {parentConfig?.modelName ? ` (${parentConfig.modelName})` : ''}
              </span>
            )
          }
        </div>
      </div>

      {/* Model selector */}
      <div className="px-4 py-3 space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Model
          </label>
          <select
            value={modelName}
            onChange={(e) => onChange(node.id, JSON.stringify({ ...config, modelName: e.target.value }))}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {MODEL_DEFINITIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Output stems */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Output Stems
          </label>
          <div className="flex flex-wrap gap-1.5">
            {stems.map((stem) => {
              const color = STEM_COLORS[stem] ?? 'bg-slate-400';
              const hasChild = nodes.some(
                (n) => n.sourceNodeId === node.id && n.sourceOutputName === stem
              );
              return (
                <button
                  key={stem}
                  onClick={() => !hasChild && onAddChild(node.id, stem)}
                  disabled={hasChild}
                  title={hasChild ? `${stem} already connected` : `Add node from ${stem}`}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-all
                    ${hasChild
                      ? 'opacity-50 cursor-not-allowed border-transparent bg-muted text-muted-foreground'
                      : 'cursor-pointer hover:scale-105 border-transparent text-white ' + color
                    }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
                  {stem}
                  {!hasChild && <span className="ml-0.5 opacity-70">+</span>}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">Click a stem to add a downstream node</p>
        </div>
      </div>
    </div>
  );
}

// ── Helper: get all descendant node IDs (for cascade delete) ──────────────────
function getDescendantIds(nodeId: string, nodes: WorkflowNode[]): string[] {
  const children = nodes.filter((n) => n.sourceNodeId === nodeId);
  return children.flatMap((c) => [c.id, ...getDescendantIds(c.id, nodes)]);
}

// ── Helper: build tree levels for layout ──────────────────────────────────────
function buildLevels(nodes: WorkflowNode[]): WorkflowNode[][] {
  if (nodes.length === 0) return [];
  const roots = nodes.filter((n) => n.sourceNodeId === null);
  if (roots.length === 0) return [nodes];
  const levels: WorkflowNode[][] = [];
  const placed = new Set(roots.map((n) => n.id));
  levels.push(roots);
  while (true) {
    const next = nodes.filter((n) => n.sourceNodeId !== null && placed.has(n.sourceNodeId) && !placed.has(n.id));
    if (next.length === 0) break;
    next.forEach((n) => placed.add(n.id));
    levels.push(next);
  }
  return levels;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WorkflowCanvasPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showExecuteDialog, setShowExecuteDialog] = useState(false);
  const [localNodes, setLocalNodes] = useState<WorkflowNode[] | null>(null);
  const [saved, setSaved] = useState(true);

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

  // Seed local nodes once workflow loads
  useEffect(() => {
    if (workflow && localNodes === null) {
      setLocalNodes(workflow.nodes.map((n) => ({
        ...n,
        sourceNodeId: n.sourceNodeId ?? null,
        sourceOutputName: n.sourceOutputName ?? null,
      })));
    }
  }, [workflow, localNodes]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const nodes = localNodes ?? [];
      const isNew = (nodeId: string) => nodeId.startsWith('new:');
      return workflowsService.update(id!, {
        name: workflow!.name,
        nodes: nodes.map((n, i) => ({
          id: isNew(n.id) ? undefined : n.id,
          order: i,
          nodeType: n.nodeType,
          configJson: n.configJson,
          // If the parent node is also new (not yet persisted), don't send the FK —
          // the user will need to save twice for multi-level new additions. For single
          // new-node additions (the common case), sourceNodeId always points to a
          // persisted parent so this is fine.
          sourceNodeId: n.sourceNodeId && isNew(n.sourceNodeId) ? null : n.sourceNodeId,
          sourceOutputName: n.sourceOutputName,
        })),
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['workflow', id], updated);
      setLocalNodes(updated.nodes.map((n) => ({
        ...n,
        sourceNodeId: n.sourceNodeId ?? null,
        sourceOutputName: n.sourceOutputName ?? null,
      })));
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

  const handleNodeChange = (nodeId: string, configJson: string) => {
    setLocalNodes((prev) =>
      (prev ?? []).map((n) => (n.id === nodeId ? { ...n, configJson } : n))
    );
    setSaved(false);
  };

  const handleAddChild = (parentNodeId: string, stemName: string) => {
    const newNode: WorkflowNode = {
      id: `new:${crypto.randomUUID()}`,
      order: (localNodes ?? []).length,
      nodeType: 'AudioSeparation',
      configJson: JSON.stringify({ modelName: 'htdemucs_ft.yaml' }),
      sourceNodeId: parentNodeId || null,
      sourceOutputName: stemName || null,
    };
    setLocalNodes((prev) => [...(prev ?? []), newNode]);
    setSaved(false);
  };

  const handleRemoveNode = (nodeId: string) => {
    const toRemove = new Set([nodeId, ...getDescendantIds(nodeId, localNodes ?? [])]);
    setLocalNodes((prev) => (prev ?? []).filter((n) => !toRemove.has(n.id)));
    setSaved(false);
  };

  if (authLoading || isLoading || !workflow) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading…</p></div>;
  }

  const nodes = localNodes ?? workflow.nodes;
  const levels = buildLevels(nodes);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80 shrink-0">
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
      <main className="flex-1 relative overflow-auto">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative flex flex-col items-center gap-0 py-12 min-h-full">
          {/* IN node */}
          <div className="flex flex-col items-center gap-2 z-10">
            <div className="w-12 h-12 rounded-full bg-slate-200 border-2 border-slate-400 flex items-center justify-center text-xs font-bold text-slate-600 shadow">
              IN
            </div>
            <span className="text-xs text-muted-foreground font-medium">Audio Input</span>
          </div>

          {/* Connector from IN to first level */}
          {levels.length > 0 && <div className="w-px h-8 bg-slate-300" />}

          {/* Node levels */}
          {levels.map((level, levelIdx) => (
            <div key={levelIdx} className="flex flex-col items-center w-full z-10">
              <div className="flex flex-row items-start justify-center gap-8 px-8 flex-wrap">
                {level.map((node) => (
                  <div key={node.id} className="flex flex-col items-center gap-0">
                    {node.sourceNodeId && (
                      <div className="flex flex-col items-center">
                        <div className="w-px h-6 bg-violet-300" />
                        <div className="text-[9px] text-violet-500 font-medium px-1.5 py-0.5 bg-violet-50 border border-violet-200 rounded-full mb-1">
                          ↓ {node.sourceOutputName}
                        </div>
                      </div>
                    )}
                    <AudioSeparationNodeCard
                      node={node}
                      index={nodes.indexOf(node)}
                      nodes={nodes}
                      onChange={handleNodeChange}
                      onAddChild={handleAddChild}
                      onRemove={handleRemoveNode}
                    />
                    {levelIdx < levels.length - 1 && nodes.some((n) => n.sourceNodeId === node.id) && (
                      <div className="w-px h-6 bg-slate-300" />
                    )}
                  </div>
                ))}
              </div>
              {levelIdx < levels.length - 1 && <div className="h-2" />}
            </div>
          ))}

          {/* Connector to OUT */}
          <div className="w-px h-8 bg-slate-300" />

          {/* OUT node */}
          <div className="flex flex-col items-center gap-2 z-10">
            <div className="w-12 h-12 rounded-full bg-violet-100 border-2 border-violet-400 flex items-center justify-center text-xs font-bold text-violet-600 shadow">
              OUT
            </div>
            <span className="text-xs text-muted-foreground font-medium">Stems Output</span>
          </div>

          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="mt-8 text-center text-muted-foreground">
              <p className="text-sm">No nodes yet.</p>
              <p className="text-xs mt-1">Add an AudioSeparation node to get started.</p>
              <Button
                className="mt-4"
                size="sm"
                onClick={() => handleAddChild('', '')}
              >
                + Add Root Node
              </Button>
            </div>
          )}
        </div>

        {/* Save error */}
        {saveMutation.isError && (
          <div className="fixed bottom-4 right-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm shadow-md z-50">
            Save failed: {(saveMutation.error as Error).message}
          </div>
        )}
      </main>

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
