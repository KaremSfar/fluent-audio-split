import { useEffect, useState } from 'react';

/**
 * Returns the current epoch-ms timestamp, refreshing it on a fixed interval while `active` is
 * true, so values derived from the current wall-clock (e.g. the elapsed time of a running node)
 * stay live on screen instead of freezing until the next unrelated re-render. Callers that only
 * need the re-render side effect can discard the return value.
 */
export function useNowTick(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return now;
}
