import { Pin } from 'lucide-react';
import type { KeepState } from '@/lib/workflowGraph';

interface KeepToggleProps {
  output: string;
  state: KeepState;
  onToggle: () => void;
  /** Row hover/focus reveal is driven by the parent's `group` class. */
}

/** Pin button marking an output as a result ("Keep"). kept / default (ghost) / none. */
export function KeepToggle({ output, state, onToggle }: KeepToggleProps) {
  const kept = state === 'kept';
  const ghost = state === 'default';
  const title = kept
    ? `${output} is kept as a result`
    : ghost
      ? 'Kept by default (no stems pinned)'
      : `Keep ${output}`;
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-pressed={kept}
        aria-label={`Keep ${output}`}
        title={title}
        // nodrag/nopan: clicks must not start a node drag or pan; stopPropagation keeps the
        // click from selecting the node.
        className={`nodrag nopan inline-flex items-center justify-center rounded p-1.5 -m-1 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
          kept
            ? 'text-amber-500'
            : ghost
              ? 'text-amber-300/60 hover:text-amber-500'
              : 'text-muted-foreground opacity-40 group-hover:opacity-100 focus-visible:opacity-100 hover:text-amber-500'
        }`}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        onKeyDown={(e) => {
          if (e.key === 'k' || e.key === 'K') { e.preventDefault(); e.stopPropagation(); onToggle(); }
        }}
      >
        <Pin className="h-3.5 w-3.5" fill={kept ? 'currentColor' : 'none'} strokeDasharray={ghost ? '2 2' : undefined} />
      </button>
      {kept && <span className="text-[9px] font-semibold text-amber-600 tracking-wide">KEPT</span>}
    </span>
  );
}
