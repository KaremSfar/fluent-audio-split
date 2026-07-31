import { useState, useCallback, useMemo } from 'react';
import { useNowTick } from '@/hooks/useNowTick';
import { StatusBadge } from './StatusBadge';
import { StemsPlayerGroup } from './StemsPlayerGroup';
import { Button } from '@/components/ui/button';
import { filesService } from '@/services/filesService';
import type { NodeExecution, WorkflowExecutionStatus } from '@/types/execution';
import type { WorkflowNode } from '@/types/workflow';

// ── Helpers ──────────────────────────────────────────────────
function formatTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function duration(start?: string, end?: string) {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// ── Props ────────────────────────────────────────────────────
export interface ExecutionDrawerProps {
  nodeExecutions: NodeExecution[];
  workflowNodes: WorkflowNode[];
  executionStatus: WorkflowExecutionStatus | null;
  executionInputFileName?: string;
  executionCreatedAt?: string;
  onRetryNode: (nodeExecutionId: string) => void;
  isRetrying: boolean;
  onReRun: () => void;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────
export function ExecutionDrawer({
  nodeExecutions,
  workflowNodes,
  executionStatus,
  executionInputFileName,
  executionCreatedAt,
  onRetryNode,
  isRetrying,
  onReRun,
  onClose,
}: ExecutionDrawerProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Keep the live "Running" durations advancing while any node is in progress.
  useNowTick(nodeExecutions.some((n) => n.status === 'Running'));

  const nodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNode>();
    for (const n of workflowNodes) map.set(n.id, n);
    return map;
  }, [workflowNodes]);

  const handleDownload = useCallback((path: string) => {
    filesService.download(path).catch(console.error);
  }, []);

  const isTerminal =
    executionStatus === 'Completed' ||
    executionStatus === 'Failed' ||
    executionStatus === 'PartiallyFailed' ||
    executionStatus === 'Cancelled';

  if (collapsed) {
    return (
      <div className="border-t border-border bg-muted/30 shrink-0">
        <button
          className="w-full flex items-center justify-between px-4 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
          onClick={() => setCollapsed(false)}
        >
          <div className="flex items-center gap-2">
            <span>▲ Execution</span>
            {executionStatus && <StatusBadge status={executionStatus} />}
          </div>
          <span>{executionInputFileName ?? ''}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-background shrink-0 flex flex-col" style={{ maxHeight: '40vh' }}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/20 shrink-0">
        <div className="flex items-center gap-3">
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(true)}
            title="Collapse"
          >
            ▼
          </button>
          <span className="text-sm font-medium">Execution</span>
          {executionStatus && <StatusBadge status={executionStatus} />}
          {executionInputFileName && (
            <span className="text-xs text-muted-foreground">
              · {executionInputFileName}
            </span>
          )}
          {executionCreatedAt && (
            <span className="text-xs text-muted-foreground">
              · {formatTime(executionCreatedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isTerminal && (
            <Button variant="outline" size="sm" onClick={onReRun} className="h-6 text-xs px-2">
              ⚡ Re-run
            </Button>
          )}
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={onClose}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Node execution rows */}
      <div className="overflow-y-auto flex-1 divide-y divide-border/30">
        {nodeExecutions.length === 0 && (
          <div className="px-4 py-3 text-sm text-muted-foreground">Waiting for nodes…</div>
        )}
        {nodeExecutions.map((node) => {
          const wfNode = nodeMap.get(node.workflowNodeId);
          const modelName = (() => {
            // Prefer the model resolved server-side from the executed version, so nodes that no
            // longer exist in the latest version still show their real model instead of "Node".
            if (node.modelName) return node.modelName.replace('.yaml', '').replace('.onnx', '');
            if (!wfNode) return null;
            try {
              const cfg = JSON.parse(wfNode.configJson);
              return cfg.modelName?.replace('.yaml', '').replace('.onnx', '') ?? null;
            } catch {
              return null;
            }
          })();

          return (
            <div key={node.id} className="px-4 py-2 flex items-center gap-3 text-sm hover:bg-muted/20">
              {/* Node label */}
              <div className="w-36 shrink-0 truncate">
                <span className="font-medium">
                  {node.nodeLabel ?? (wfNode ? `Node ${wfNode.order + 1}` : 'Node')}
                </span>
                {modelName && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({modelName})</span>
                )}
              </div>

              {/* Status */}
              <div className="w-28 shrink-0">
                <StatusBadge status={node.status} />
              </div>

              {/* Timing */}
              <div className="w-16 shrink-0 text-xs text-muted-foreground text-right">
                {duration(node.startedAt, node.completedAt)}
              </div>

              {/* Attempt */}
              <div className="w-16 shrink-0 text-xs text-muted-foreground">
                #{node.attempt}
              </div>

              {/* Actions */}
              <div className="flex-1 flex items-center justify-end gap-2">
                {/* Error message */}
                {node.errorMessage && (
                  <span className="text-[10px] text-red-500 truncate max-w-[200px]" title={node.errorMessage}>
                    {node.errorMessage}
                  </span>
                )}

                {/* Retry */}
                {node.status === 'Failed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => onRetryNode(node.id)}
                    disabled={isRetrying}
                  >
                    ↩ Retry
                  </Button>
                )}

                {/* Output stems: inline waveform players (synced) + download */}
                {node.status === 'Completed' && Object.keys(node.outputArtifactPaths).length > 0 && (
                  <StemsPlayerGroup stems={node.outputArtifactPaths} compact onDownload={handleDownload} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
