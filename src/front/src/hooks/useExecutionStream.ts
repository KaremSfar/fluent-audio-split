import { useEffect, useRef } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import type { NodeStatusEvent, ExecutionStatusEvent } from '../types/execution';

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

interface UseExecutionStreamOptions {
  executionId: string | undefined;
  onNodeStatus: (event: NodeStatusEvent) => void;
  onExecutionStatus: (event: ExecutionStatusEvent) => void;
  enabled?: boolean;
}

export function useExecutionStream({
  executionId,
  onNodeStatus,
  onExecutionStatus,
  enabled = true,
}: UseExecutionStreamOptions) {
  const abortRef = useRef<AbortController | null>(null);
  const baseUrl = (import.meta.env.VITE_SERVICE_URL ?? 'http://localhost:5001') as string;

  useEffect(() => {
    if (!executionId || !enabled) return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const token = getToken();

    fetchEventSource(`${baseUrl}/api/executions/${executionId}/stream`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      signal: ctrl.signal,
      onmessage(ev) {
        try {
          const data = JSON.parse(ev.data) as Record<string, unknown>;
          const type = data.type as string;

          if (type === 'NodeStarted' || type === 'NodeCompleted' || type === 'NodeFailed') {
            onNodeStatus({
              nodeExecutionId: data.nodeExecutionId as string,
              status: type === 'NodeStarted' ? 'Running' : type === 'NodeCompleted' ? 'Completed' : 'Failed',
              attempt: (data.attempt as number) ?? 1,
              outputPaths: (data.outputArtifactPaths as string[]) ?? undefined,
              errorMessage: data.errorMessage as string | undefined,
            });
          } else if (type === 'ExecutionRunning' || type === 'ExecutionCompleted' || type === 'ExecutionPartiallyFailed') {
            onExecutionStatus({
              status: type === 'ExecutionCompleted' ? 'Completed'
                : type === 'ExecutionRunning' ? 'Running'
                : 'PartiallyFailed',
            });
          }
        } catch (e) {
          console.error('SSE parse error', e);
        }
      },
      onerror(err) {
        console.error('SSE error', err);
        // Rethrow fatal errors (non-CORS, non-network) to stop retrying
        if (err instanceof TypeError) {
          throw err; // stops the loop; component can show a static fallback
        }
      },
    });

    return () => {
      ctrl.abort();
    };
  }, [executionId, enabled]);
}
