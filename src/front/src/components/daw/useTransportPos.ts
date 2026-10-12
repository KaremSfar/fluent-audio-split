import { useEffect, useState } from 'react';
import type { StemSyncEngine } from '@/components/execution/stemSyncEngine';

/** Transport position in seconds (clamped to >= 0), refreshed every frame while the transport runs. */
export function useTransportPos(engine: StemSyncEngine): number {
  const [pos, setPos] = useState(() => Math.max(0, engine.nowPos()));

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setPos(Math.max(0, engine.nowPos()));
      if (engine.getTransport().running) raf = requestAnimationFrame(loop);
    };
    const off = engine.onTransportChange(() => {
      cancelAnimationFrame(raf);
      loop();
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [engine]);

  return pos;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(3).padStart(6, '0')}`;
}
