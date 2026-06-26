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
      // Only send the header when we actually have a token — an empty `Bearer` is malformed.
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: ctrl.signal,
      async onopen(res) {
        // Auth failures never recover on retry — stop the loop so the UI can fall back.
        if (res.status === 401 || res.status === 403) {
          throw new Error(`SSE unauthorized (${res.status})`);
        }
      },
      onmessage(ev) {
        try {
          const data = JSON.parse(ev.data) as Record<string, unknown>;
          const type = data.type as string;

          if (type === 'NodeStarted' || type === 'NodeCompleted' || type === 'NodeFailed') {
            onNodeStatus({
              nodeExecutionId: data.nodeExecutionId as string,
              workflowNodeId: data.workflowNodeId as string | undefined,
              status: type === 'NodeStarted' ? 'Running' : type === 'NodeCompleted' ? 'Completed' : 'Failed',
              attempt: data.attempt as number | undefined,
              outputPaths: (data.outputArtifactPaths as Record<string, string>) ?? undefined,
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
        // Rethrow fatal errors (auth / programming errors) to stop retrying; transient
        // network errors fall through and @microsoft/fetch-event-source reconnects.
        if (err instanceof TypeError || (err instanceof Error && err.message.startsWith('SSE unauthorized'))) {
          throw err; // stops the loop; component can show a static fallback
        }
      },
    });

    return () => {
      ctrl.abort();
    };
  }, [executionId, enabled]);
}
