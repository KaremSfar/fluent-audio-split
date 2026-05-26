import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { executionsService } from '@/services/executionsService';
import { filesService } from '@/services/filesService';
import { workflowsService } from '@/services/workflowsService';
import { useExecutionStream } from '@/hooks/useExecutionStream';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/execution/StatusBadge';
import { NodeExecutionCard } from '@/components/execution/NodeExecutionCard';
import { AppHeader } from '@/components/layout/AppHeader';
import type {
  NodeExecution,
  WorkflowExecutionStatus,
  NodeStatusEvent,
  ExecutionStatusEvent,
} from '@/types/execution';
import type { WorkflowNode } from '@/types/workflow';

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString();
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
