import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { AvailableStem } from '@/types/results';
import { cn } from '@/lib/utils';
import { ctl, neutral } from './ui';

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
        className={cn(ctl, neutral, 'pl-2')}
      >
        <Plus className="size-4" aria-hidden="true" /> Add track
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-30 mb-1 max-h-72 w-64 overflow-auto rounded-md border bg-popover py-1 text-sm text-popover-foreground shadow-lg">
          {[...groups.entries()].map(([node, stems]) => (
            <div key={node}>
              <p className="px-3 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">{node}</p>
              {stems.map((s) => (
                <button
                  key={`${s.workflowNodeId}:${s.outputName}`}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAdd(s);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
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
