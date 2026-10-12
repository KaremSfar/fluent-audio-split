import { useNowTick } from '@/hooks/useNowTick';
import type { NodeExecOverlay } from './nodeData';

const statusFooter: Record<string, { icon: string; label: string; color: string }> = {
  Pending: { icon: '○', label: 'Pending', color: 'text-muted-foreground' },
  Queued: { icon: '○', label: 'Queued', color: 'text-muted-foreground' },
  Running: { icon: '⏳', label: 'Running', color: 'text-blue-600 dark:text-blue-400' },
  Completed: { icon: '✅', label: 'Done', color: 'text-green-600 dark:text-green-400' },
  Failed: { icon: '✗', label: 'Failed', color: 'text-red-600 dark:text-red-400' },
  Cancelled: { icon: '—', label: 'Cancelled', color: 'text-muted-foreground' },
};

/** Execution status footer + failure snippet, shared by Split and Merge cards. */
export function NodeExecFooter({ execStatus, execStartedAt, execCompletedAt, execErrorMessage }: NodeExecOverlay) {
  // The "Running" elapsed time is derived from the wall-clock at render time; tick so it advances.
  const now = useNowTick(execStatus === 'Running');
  const footer = execStatus ? statusFooter[execStatus] : null;
  if (!footer) return null;

  const elapsed = (() => {
    if (!execStartedAt) return null;
    const start = new Date(execStartedAt).getTime();
    const end = execCompletedAt ? new Date(execCompletedAt).getTime() : now;
    const s = Math.round((end - start) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  })();

  return (
    <>
      <div className={`border-t border-border/50 px-3 py-1.5 flex items-center gap-2 ${footer.color}`}>
        <span className="text-sm">{footer.icon}</span>
        <span className="text-xs font-medium">{footer.label}</span>
        {elapsed && <span className="text-[10px] text-muted-foreground ml-auto">{elapsed}</span>}
      </div>
      {execStatus === 'Failed' && execErrorMessage && (
        <div className="px-3 pb-2">
          <p className="text-[9px] text-red-500 dark:text-red-400 truncate" title={execErrorMessage}>{execErrorMessage}</p>
        </div>
      )}
    </>
  );
}
