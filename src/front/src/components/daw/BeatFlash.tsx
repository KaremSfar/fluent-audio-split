import { useEffect, useRef } from 'react';
import type { StemSyncEngine } from '@/components/execution/stemSyncEngine';
import { beatIndexFloor, type BeatGrid } from './beatGrid';
import { prefersReducedMotion } from './useTransportPos';

const FLASH_SEC = 0.09;

interface BeatFlashProps {
  engine: StemSyncEngine;
  grid: BeatGrid;
  /** Flash enabled, click on, and transport playing. */
  active: boolean;
  /** True when the beat at `pos` should not flash (gap-click silence without the visual cue). */
  suppressAt: (pos: number) => boolean;
}

/**
 * Screen-edge flash on each beat (stronger, violet on beat 1). Driven from the engine clock in its
 * own rAF loop that writes styles directly (no React re-render per frame). Never rendered with
 * prefers-reduced-motion.
 */
export function BeatFlash({ engine, grid, active, suppressAt }: BeatFlashProps) {
  const ref = useRef<HTMLDivElement>(null);
  const suppressRef = useRef(suppressAt);
  useEffect(() => {
    suppressRef.current = suppressAt;
  });
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || !active || reduced) return;
    let raf = 0;
    const loop = () => {
      const pos = engine.nowPos();
      let opacity = 0;
      if (pos >= 0) {
        const k = beatIndexFloor(grid, pos);
        const since = pos - grid.beatTime(k);
        if (since >= 0 && since < FLASH_SEC && !suppressRef.current(pos)) {
          const one = grid.beatInBar(k) === 0;
          opacity = (1 - since / FLASH_SEC) * (one ? 1 : 0.55);
          el.dataset.one = one ? 'true' : 'false';
        }
      }
      el.style.opacity = String(opacity);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      el.style.opacity = '0';
    };
  }, [engine, grid, active, reduced]);

  if (reduced) return null;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-one="false"
      className="pointer-events-none fixed inset-0 z-50 opacity-0 shadow-[inset_0_0_0_6px_rgba(113,113,122,0.55)] data-[one=true]:shadow-[inset_0_0_0_10px_rgba(124,58,237,0.85)] dark:shadow-[inset_0_0_0_6px_rgba(244,244,245,0.7)] dark:data-[one=true]:shadow-[inset_0_0_0_10px_rgba(167,139,250,0.95)]"
    />
  );
}
