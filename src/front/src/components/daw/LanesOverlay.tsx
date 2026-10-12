import type { LoopRegion, StemSyncEngine } from '@/components/execution/stemSyncEngine';
import type { Anchor } from './beatGrid';
import { useTransportPos } from './useTransportPos';

interface LanesOverlayProps {
  engine: StemSyncEngine;
  duration: number;
  loop: LoopRegion | null;
  anchors: readonly Anchor[];
}

/**
 * One playhead, loop band and anchor guides drawn across every lane (and the empty area below them),
 * aligned with the ruler. Purely visual: pointer events fall through to the waveforms for seeking.
 * Only used in the two-column (md+) layout.
 */
export function LanesOverlay({ engine, duration, loop, anchors }: LanesOverlayProps) {
  const pos = useTransportPos(engine);
  const pct = (t: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-[300px] right-0 hidden px-2 md:block">
      <div className="relative h-full">
        {loop && (
          <div
            className="absolute inset-y-0 border-x border-primary/50 bg-primary/[0.07]"
            style={{ left: `${pct(loop.start)}%`, width: `${pct(loop.end) - pct(loop.start)}%` }}
          />
        )}
        {anchors.map((a) => (
          <div
            key={`${a.kind}:${a.pos}`}
            className={
              a.kind === 'beat'
                ? 'absolute inset-y-0 border-l border-dashed border-amber-600/50 dark:border-amber-400/40'
                : 'absolute inset-y-0 border-l border-dashed border-primary/50 dark:border-daw-bar/50'
            }
            style={{ left: `${pct(a.pos)}%` }}
          />
        ))}
        {duration > 0 && <div className="absolute inset-y-0 w-px bg-daw-playhead" style={{ left: `${pct(pos)}%` }} />}
      </div>
    </div>
  );
}
