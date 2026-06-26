import type { NodeExecution, NodeStatusEvent } from '@/types/execution';

/**
 * Apply an SSE node-status event to the current list of node executions.
 *
 * The backend creates downstream node executions lazily (chaining) and retries create a
 * brand-new NodeExecution id, so an event can reference an id we have not seen yet. When
 * that happens we fall back to the event's `workflowNodeId` to insert/replace the row for
 * that node — keeping exactly one row per workflow node (the latest attempt). Events that
 * match an existing id are updated in place.
 */
export function applyNodeStatusEvent(
  prev: NodeExecution[],
  ev: NodeStatusEvent,
  now: string = new Date().toISOString(),
): NodeExecution[] {
  const idx = prev.findIndex((n) => n.id === ev.nodeExecutionId);

  if (idx >= 0) {
    const existing = prev[idx];
    const next = prev.slice();
    next[idx] = {
      ...existing,
      status: ev.status,
      attempt: ev.attempt ?? existing.attempt,
      // Preserve a prior error when the event carries none (NodeStarted/NodeCompleted send no errorMessage).
      errorMessage: ev.errorMessage ?? existing.errorMessage,
      outputArtifactPaths: ev.outputPaths ?? existing.outputArtifactPaths,
      startedAt: ev.status === 'Running' && !existing.startedAt ? now : existing.startedAt,
      completedAt:
        ev.status === 'Completed' || ev.status === 'Failed' ? now : existing.completedAt,
    };
    return next;
  }

  // Unknown node-execution id: only placeable if we know which workflow node it belongs to.
  if (!ev.workflowNodeId) return prev;

  const added: NodeExecution = {
    id: ev.nodeExecutionId,
    workflowNodeId: ev.workflowNodeId,
    attempt: ev.attempt ?? 1,
    status: ev.status,
    outputArtifactPaths: ev.outputPaths ?? {},
    errorMessage: ev.errorMessage,
    startedAt: ev.status === 'Running' ? now : undefined,
    completedAt: ev.status === 'Completed' || ev.status === 'Failed' ? now : undefined,
  };
  // Supersede any prior attempt for the same workflow node (one row per node).
  return [...prev.filter((n) => n.workflowNodeId !== ev.workflowNodeId), added];
}

/**
 * Insert or replace a full NodeExecution (e.g. the response of a retry), keeping one row
 * per workflow node so a new attempt supersedes the old failed row.
 */
export function upsertNodeExecution(
  prev: NodeExecution[],
  next: NodeExecution,
): NodeExecution[] {
  return [...prev.filter((n) => n.workflowNodeId !== next.workflowNodeId), next];
}
