import { useEffect, useState } from 'react';

/**
 * Forces a re-render on a fixed interval while `active` is true, so values derived from the
 * current wall-clock (e.g. the elapsed time of a running node) stay live on screen instead
 * of freezing until the next unrelated re-render.
 */
export function useNowTick(active: boolean, intervalMs = 1000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
}
