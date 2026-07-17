import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  text: string;
}

export function Tooltip({ text }: TooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.top - 6, left: r.left + r.width / 2 });
    }
  }, []);

  const hide = useCallback(() => setPos(null), []);

  return (
    <span
      ref={ref}
      className="inline-flex items-center ml-1 cursor-help"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <span className="text-[10px] leading-none text-muted-foreground/50 hover:text-muted-foreground select-none">ⓘ</span>
      {pos && createPortal(
        <span
          className="pointer-events-none fixed z-[99999] w-60 rounded-md bg-popover border border-border text-popover-foreground text-[11px] leading-snug p-2 shadow-lg whitespace-normal"
          style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}
