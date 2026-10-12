import { cn } from '@/lib/utils';
import { clampDb, dbToFaderPos, dbValueText, faderPosToDb, formatDb } from './gain';

interface VolumeFaderProps {
  label: string;
  valueDb: number;
  onChange: (db: number) => void;
  showReadout?: boolean;
  className?: string;
}

const SNAP_DB = 0.15;
const ZERO_POS = dbToFaderPos(0);

function stepDb(current: number, delta: number): number {
  if (current === -Infinity) return delta > 0 ? -60 : -Infinity;
  const next = current + delta;
  return next <= -60 && delta < 0 && current > -60 ? -60 : clampDb(next);
}

/**
 * Horizontal fader on a native range input (best a11y baseline). The slider value is the taper
 * position; `aria-valuetext` carries the dB. Arrow keys step in dB (±0.5, Shift ±0.1), PageUp/Down
 * ±6, Home = −∞, End = +6; double-click or Alt+click resets to 0 dB.
 */
export function VolumeFader({ label, valueDb, onChange, showReadout = true, className }: VolumeFaderProps) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const fine = e.shiftKey ? 0.1 : 0.5;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = stepDb(valueDb, fine);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = stepDb(valueDb, -fine);
        break;
      case 'PageUp':
        next = stepDb(valueDb, 6);
        break;
      case 'PageDown':
        next = stepDb(valueDb, -6);
        break;
      case 'Home':
        next = -Infinity;
        break;
      case 'End':
        next = 6;
        break;
    }
    if (next !== null) {
      e.preventDefault();
      e.stopPropagation();
      onChange(next);
    }
  };

  const pos = dbToFaderPos(valueDb);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative flex min-w-0 flex-1 items-center">
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={pos}
          aria-label={label}
          aria-valuetext={dbValueText(valueDb)}
          title={`${formatDb(valueDb)} (double-click or Alt+click to reset)`}
          onChange={(e) => {
            const db = faderPosToDb(Number(e.target.value));
            onChange(Math.abs(db) < SNAP_DB ? 0 : db);
          }}
          onKeyDown={onKeyDown}
          onDoubleClick={() => onChange(0)}
          onPointerDown={(e) => {
            if (e.altKey) {
              e.preventDefault();
              onChange(0);
            }
          }}
          style={{ '--fill': `calc(7px + ${pos} * (100% - 14px))` } as React.CSSProperties}
          className="daw-range relative min-w-0 flex-1"
        />
        {/* 0 dB detent mark (thumb is 14 px, so the travel is inset by 7 px each side). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[calc(50%+5px)] h-1.5 w-px bg-muted-foreground/60"
          style={{ left: `calc(7px + ${ZERO_POS} * (100% - 14px))` }}
        />
      </div>
      {showReadout && (
        <span aria-hidden="true" className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatDb(valueDb)}
        </span>
      )}
    </div>
  );
}
