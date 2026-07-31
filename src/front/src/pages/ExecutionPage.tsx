import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { executionsService } from '@/services/executionsService';
import { filesService } from '@/services/filesService';
import { workflowsService } from '@/services/workflowsService';
import { useExecutionStream } from '@/hooks/useExecutionStream';
import { applyNodeStatusEvent, upsertNodeExecution } from '@/lib/executionState';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/execution/StatusBadge';
import { NodeExecutionCard } from '@/components/execution/NodeExecutionCard';
import { AppHeader } from '@/components/layout/AppHeader';
import type {
  NodeExecution,
  WorkflowExecution,
  WorkflowExecutionStatus,
  NodeStatusEvent,
  ExecutionStatusEvent,
} from '@/types/execution';
import type { WorkflowNode } from '@/types/workflow';

function formatTime(iso?: string): string {
  if (!iso) return '—';
  // Include the date, not just the time — executions can span midnight, and a time-only display
  // makes a next-day completion look like it finished before it started.
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
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
    // Upsert by id, falling back to workflowNodeId so lazily-created downstream nodes and
    // retried nodes (new ids) are inserted rather than dropped.
    setNodeExecutions((prev) => applyNodeStatusEvent(prev, ev));
  }, []);

  const onExecutionStatus = useCallback((ev: ExecutionStatusEvent) => {
    setExecStatus(ev.status);
    if (ev.status === 'Completed' || ev.status === 'PartiallyFailed' ||
        ev.status === 'Failed' || ev.status === 'Cancelled') {
      queryClient.invalidateQueries({ queryKey: ['execution', id] });
    }
  }, [id, queryClient]);

  const onSnapshot = useCallback((fresh: WorkflowExecution) => {
    // Full reconciliation on (re)connect — covers events published before this subscriber
    // attached that the terminal-only invalidate above wouldn't otherwise catch.
    setNodeExecutions(fresh.nodeExecutions);
    setExecStatus(fresh.status);
  }, []);

  useExecutionStream({
    executionId: id,
    onNodeStatus,
    onExecutionStatus,
    onSnapshot,
    enabled: !isTerminal && isAuthenticated,
  });

  const retryMutation = useMutation({
    mutationFn: ({ nodeExecutionId }: { nodeExecutionId: string }) =>
      executionsService.retry(id!, nodeExecutionId),
    onSuccess: (updated) => {
      // Retry creates a new node execution (new id); replace by workflowNodeId so the new
      // attempt supersedes the old failed row.
      setNodeExecutions((prev) => upsertNodeExecution(prev, updated));
      // The retry endpoint puts the execution back into Running server-side. Reset the local
      // status so it's no longer treated as terminal — otherwise the SSE stream stays gated off
      // and the retry's live progress (and its terminal event) would be missed.
      setExecStatus('Running');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => executionsService.cancel(id!),
    onSuccess: (updated) => {
      setExecStatus(updated.status);
      setNodeExecutions(updated.nodeExecutions);
      queryClient.invalidateQueries({ queryKey: ['execution', id] });
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
      <AppHeader onLogoClick={() => navigate('/dashboard')}>
        <Button variant="outline" size="sm" onClick={() => navigate('/executions')}>
          ← Executions
        </Button>
      </AppHeader>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header info */}
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{execution.workflowName}</h1>
            <StatusBadge status={currentStatus} />
            {(currentStatus === 'Running' || currentStatus === 'Pending') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? 'Cancelling…' : '⨯ Cancel'}
              </Button>
            )}
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
              onDownload={(path) => filesService.download(path).catch(console.error)}
              isRetrying={retryMutation.isPending}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
