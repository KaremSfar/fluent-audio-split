import type { NodeExecution } from '@/types/execution';
import type { WorkflowNode } from '@/types/workflow';
import { StatusBadge } from '@/components/execution/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StemsPlayerGroup, type StemsPlayerGroupProps } from '@/components/execution/StemsPlayerGroup';

interface NodeExecutionCardProps {
  node: NodeExecution;
  workflowNode?: WorkflowNode;
  onRetry: () => void;
  onDownload: (path: string) => void;
  isRetrying: boolean;
  /** Shared across every node's card on the page so all stems play through one audio clock and
   * stay in exact sync across nodes. See `StemsPlayerGroup`. */
  engine?: StemsPlayerGroupProps['engine'];
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString();
}

function duration(start?: string, end?: string): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function NodeExecutionCard({
  node,
  workflowNode,
  onRetry,
  onDownload,
  isRetrying,
  engine,
}: NodeExecutionCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">
            {node.nodeLabel ?? (workflowNode ? `Node ${workflowNode.order + 1}` : 'Audio Separation')}
            {(() => {
              // Prefer the model name resolved server-side from the executed version; fall back
              // to the latest workflow node's config only when the server didn't provide one.
              let modelName = node.modelName ?? null;
              if (!modelName && workflowNode) {
                try { modelName = JSON.parse(workflowNode.configJson).modelName ?? null; } catch { modelName = null; }
              }
              return modelName
                ? <span className="ml-2 text-sm font-normal text-muted-foreground">({modelName.replace('.yaml', '')})</span>
                : null;
            })()}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Attempt #{node.attempt}</span>
            <StatusBadge status={node.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Started</p>
            <p>{formatTime(node.startedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Completed</p>
            <p>{formatTime(node.completedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Duration</p>
            <p>{duration(node.startedAt, node.completedAt)}</p>
          </div>
        </div>

        {node.errorMessage && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {node.errorMessage}
          </div>
        )}

        {node.status === 'Failed' && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={isRetrying}>
            {isRetrying ? 'Retrying…' : '↩ Retry'}
          </Button>
        )}

        {node.status === 'Completed' && Object.keys(node.outputArtifactPaths).length > 0 && (
          <StemsPlayerGroup stems={node.outputArtifactPaths} onDownload={onDownload} engine={engine} />
        )}
      </CardContent>
    </Card>
  );
}
