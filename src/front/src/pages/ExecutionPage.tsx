import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { executionsService } from '@/services/executionsService';
import { filesService } from '@/services/filesService';
import { workflowsService } from '@/services/workflowsService';
import { useExecutionStream } from '@/hooks/useExecutionStream';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  NodeExecution,
  WorkflowExecutionStatus,
  NodeExecutionStatus,
  NodeStatusEvent,
  ExecutionStatusEvent,
} from '@/types/execution';
import type { WorkflowNode } from '@/types/workflow';

function statusColor(status: WorkflowExecutionStatus | NodeExecutionStatus): string {
  switch (status) {
    case 'Completed': return 'bg-green-100 text-green-800';
    case 'Running': return 'bg-blue-100 text-blue-800';
    case 'Failed': return 'bg-red-100 text-red-800';
    case 'PartiallyFailed': return 'bg-yellow-100 text-yellow-800';
    case 'Cancelled': return 'bg-gray-100 text-gray-600';
    default: return 'bg-gray-100 text-gray-800';
  }
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

export default function ExecutionPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login');
  }, [isAuthenticated, isLoading, navigate]);

  const { data: execution, isLoading: execLoading } = useQuery({
    queryKey: ['execution', id],
    queryFn: () => executionsService.get(id!),
    enabled: !!id && isAuthenticated,
  });

  const { data: workflow } = useQuery({
    queryKey: ['workflow', execution?.workflowId],
    queryFn: () => workflowsService.get(execution!.workflowId),
    enabled: !!execution?.workflowId && isAuthenticated,
  });

  const nodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNode>();
    if (workflow) {
      for (const n of workflow.nodes) map.set(n.id, n);
    }
    return map;
  }, [workflow]);

  const [nodeExecutions, setNodeExecutions] = useState<NodeExecution[]>([]);
  const [execStatus, setExecStatus] = useState<WorkflowExecutionStatus | null>(null);

  useEffect(() => {
    if (execution) {
      setNodeExecutions(execution.nodeExecutions);
      setExecStatus(execution.status);
    }
  }, [execution]);

  const isTerminal = execStatus === 'Completed' || execStatus === 'Failed' ||
    execStatus === 'PartiallyFailed' || execStatus === 'Cancelled';

  const onNodeStatus = useCallback((ev: NodeStatusEvent) => {
    setNodeExecutions((prev) =>
      prev.map((n) =>
        n.id === ev.nodeExecutionId
          ? {
              ...n,
              status: ev.status,
              attempt: ev.attempt ?? n.attempt,
              errorMessage: ev.errorMessage,
              outputArtifactPaths: ev.outputPaths ?? n.outputArtifactPaths,
            }
          : n
      )
    );
  }, []);

  const onExecutionStatus = useCallback((ev: ExecutionStatusEvent) => {
    setExecStatus(ev.status);
    if (ev.status === 'Completed' || ev.status === 'PartiallyFailed') {
      queryClient.invalidateQueries({ queryKey: ['execution', id] });
    }
  }, [id, queryClient]);

  useExecutionStream({
    executionId: id,
    onNodeStatus,
    onExecutionStatus,
    enabled: !isTerminal && isAuthenticated,
  });

  const retryMutation = useMutation({
    mutationFn: ({ nodeExecutionId }: { nodeExecutionId: string }) =>
      executionsService.retry(id!, nodeExecutionId),
    onSuccess: (updated) => {
      setNodeExecutions((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n))
      );
    },
  });

  if (isLoading || execLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Execution not found.</p>
      </div>
    );
  }

  const currentStatus = execStatus ?? execution.status;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80">
            <span className="text-xl">🎵</span>
            <span className="font-semibold text-foreground">Fluent Audio Split</span>
          </button>
          <Button variant="outline" size="sm" onClick={() => navigate('/executions')}>
            ← Executions
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header info */}
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{execution.workflowName}</h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusColor(currentStatus)}`}
            >
              {currentStatus}
            </span>
          </div>
          <p className="text-muted-foreground text-sm">
            File: <span className="font-medium text-foreground">{execution.inputFile.originalFileName}</span>
            {' · '}
            Started: {formatTime(execution.createdAt)}
            {execution.completedAt && ` · Completed: ${formatTime(execution.completedAt)}`}
          </p>
          {execution.errorMessage && (
            <p className="text-red-600 text-sm">{execution.errorMessage}</p>
          )}
        </div>

        {/* Node execution cards */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Node Executions</h2>
          {nodeExecutions.length === 0 && (
            <p className="text-muted-foreground">No node executions yet.</p>
          )}
          {nodeExecutions.map((node) => (
            <NodeExecutionCard
              key={node.id}
              node={node}
              workflowNode={nodeMap.get(node.workflowNodeId)}
              onRetry={() => retryMutation.mutate({ nodeExecutionId: node.id })}
              isRetrying={retryMutation.isPending}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

function NodeExecutionCard({
  node,
  workflowNode,
  onRetry,
  isRetrying,
}: {
  node: NodeExecution;
  workflowNode?: WorkflowNode;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">
            {workflowNode ? `Node ${workflowNode.order + 1}` : 'Audio Separation'}
            {workflowNode && (() => {
              try {
                const cfg = JSON.parse(workflowNode.configJson);
                return cfg.modelName ? <span className="ml-2 text-sm font-normal text-muted-foreground">({cfg.modelName.replace('.yaml', '')})</span> : null;
              } catch { return null; }
            })()}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Attempt #{node.attempt}</span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor(node.status)}`}
            >
              {node.status}
            </span>
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
          <div className="space-y-2">
            <p className="text-sm font-medium">Download Stems</p>
            <ul className="space-y-1">
              {Object.entries(node.outputArtifactPaths).map(([stem, path]) => (
                <li key={stem} className="flex items-center gap-2">
                  <span className="font-medium text-violet-600 min-w-[80px]">{stem}</span>
                  <button
                    onClick={() => filesService.download(path).catch(console.error)}
                    className="text-sm text-primary hover:underline text-left truncate"
                  >
                    ⬇ {path.split('/').pop() ?? path}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
