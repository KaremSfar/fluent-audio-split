import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { AvailableStem } from '@/types/results';

interface AddTrackPopoverProps {
  available: AvailableStem[];
  onAdd: (stem: AvailableStem) => void;
  disabled?: boolean;
}

/** "+ Add track" menu listing the other produced stems, grouped by node. */
export function AddTrackPopover({ available, onAdd, disabled }: AddTrackPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups = new Map<string, AvailableStem[]>();
  for (const a of available) {
    const list = groups.get(a.nodeLabel) ?? [];
    list.push(a);
    groups.set(a.nodeLabel, list);
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || available.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1 rounded-md bg-zinc-800 px-3 text-sm text-zinc-100 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50"
      >
        <Plus className="size-4" /> Add track
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-30 mb-1 max-h-72 w-64 overflow-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 text-sm text-zinc-100 shadow-lg">
          {[...groups.entries()].map(([node, stems]) => (
            <div key={node}>
              <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-zinc-400">{node}</p>
              {stems.map((s) => (
                <button
                  key={`${s.workflowNodeId}:${s.outputName}`}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAdd(s);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none"
                >
                  {s.displayName}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
