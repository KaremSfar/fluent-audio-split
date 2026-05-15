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
import type { WorkflowNode } from '@/types/workflow';
import type { FileRecord } from '@/types/file';

const MODEL_OPTIONS = [
  { value: 'htdemucs_ft',            label: 'htdemucs_ft — fine-tuned 4-stem (recommended)' },
  { value: 'htdemucs',               label: 'htdemucs — 4-stem hybrid transformer' },
  { value: 'htdemucs_6s',            label: 'htdemucs_6s — 6-stem (+ guitar & piano)' },
  { value: 'mdx_extra',              label: 'mdx_extra — MDX 4-stem extra quality' },
  { value: 'UVR-MDX-NET-Inst_HQ_3', label: 'UVR-MDX-NET-Inst_HQ_3 — instrumental/vocals' },
];

// ── Node card shown on the canvas ─────────────────────────────────────────────
function AudioSeparationNodeCard({
  node,
  onChange,
}: {
  node: WorkflowNode;
  onChange: (configJson: string) => void;
}) {
  const config = (() => { try { return JSON.parse(node.configJson); } catch { return {}; } })();

  return (
    <div className="w-72 rounded-xl border-2 border-violet-400 bg-background shadow-lg">
      {/* Node header */}
      <div className="bg-violet-500 text-white rounded-t-xl px-4 py-2 flex items-center gap-2">
        <span className="text-lg">��</span>
        <span className="font-semibold text-sm">Audio Separation</span>
        <Badge variant="secondary" className="ml-auto text-xs bg-violet-300 text-violet-900">
          Node 1
        </Badge>
      </div>

      {/* Node body */}
      <div className="px-4 py-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Model
          </label>
          <select
            value={config.modelName ?? 'htdemucs_ft'}
            onChange={(e) => onChange(JSON.stringify({ ...config, modelName: e.target.value }))}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="text-xs text-muted-foreground pt-1 border-t">
          Input: audio file &nbsp;→&nbsp; Output: separated stems
        </div>
      </div>

      {/* Input/output connectors hint */}
      <div className="flex justify-between px-4 pb-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400" />input</span>
        <span className="flex items-center gap-1">output<span className="w-2 h-2 rounded-full bg-violet-400" /></span>
      </div>
    </div>
  );
}

// ── Execute dialog ─────────────────────────────────────────────────────────────
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

// ── Main page ──────────────────────────────────────────────────────────────────
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
    if (workflow && localNodes === null) setLocalNodes(workflow.nodes);
  }, [workflow, localNodes]);

  const saveMutation = useMutation({
    mutationFn: () =>
      workflowsService.update(id!, {
        name: workflow!.name,
        nodes: (localNodes ?? []).map((n) => ({
          id: n.id,
          order: n.order,
          nodeType: n.nodeType,
          configJson: n.configJson,
        })),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['workflow', id], updated);
      setLocalNodes(updated.nodes);
      setSaved(true);
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (fileId: string) => {
      // Auto-save before executing if there are unsaved changes
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

  if (authLoading || isLoading || !workflow) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading…</p></div>;
  }

  const nodes = localNodes ?? workflow.nodes;

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

            <Button
              size="sm"
              onClick={() => setShowExecuteDialog(true)}
            >
              ⚡ Execute
            </Button>
          </div>

          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
            ← Back
          </Button>
        </div>
      </header>

      {/* Canvas */}
      <main className="flex-1 relative overflow-hidden">
        {/* Grid background */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* Canvas content */}
        <div className="relative flex items-center justify-center min-h-full p-16">
          <div className="flex flex-col items-center gap-6">
            {/* START label */}
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-slate-200 border-2 border-slate-400 flex items-center justify-center text-xs font-bold text-slate-600">
                IN
              </div>
              <span className="text-xs text-muted-foreground font-medium">Audio Input</span>
            </div>

            {/* Connector */}
            <div className="w-px h-8 bg-slate-300" />

            {/* Node cards */}
            {nodes.map((node) => (
              <div key={node.id} className="flex flex-col items-center gap-0">
                <AudioSeparationNodeCard
                  node={node}
                  onChange={(configJson) => handleNodeChange(node.id, configJson)}
                />
                <div className="w-px h-8 bg-slate-300" />
              </div>
            ))}

            {/* END label */}
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-violet-100 border-2 border-violet-400 flex items-center justify-center text-xs font-bold text-violet-600">
                OUT
              </div>
              <span className="text-xs text-muted-foreground font-medium">Stems Output</span>
            </div>
          </div>
        </div>

        {/* Save error */}
        {saveMutation.isError && (
          <div className="absolute bottom-4 right-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm shadow-md">
            Save failed: {(saveMutation.error as Error).message}
          </div>
        )}
      </main>

      {/* Execute dialog */}
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
