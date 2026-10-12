import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { NodeType } from '@/types/workflow';

interface AddNodeMenuProps {
  onAdd: (type: NodeType) => void;
  disabled?: boolean;
  disabledTitle?: string;
}

/** "+ Add Node" split-button menu: Split (S) / Merge (G). */
export function AddNodeMenu({ onAdd, disabled, disabledTitle }: AddNodeMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (type: NodeType) => {
    setOpen(false);
    onAdd(type);
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        + Add Node ▾
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-56 rounded-md border bg-background shadow-lg z-50 py-1">
          <button
            role="menuitem"
            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between"
            onClick={() => pick('AudioSeparation')}
          >
            <span>Split (separation model)</span>
            <kbd className="text-[10px] text-muted-foreground">S</kbd>
          </button>
          <button
            role="menuitem"
            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between"
            onClick={() => pick('Merge')}
          >
            <span>Merge stems</span>
            <kbd className="text-[10px] text-muted-foreground">G</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
