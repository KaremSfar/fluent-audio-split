import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { MeterBus } from './useMeters';

interface LevelMeterProps {
  /** Engine analyser key: a track id or `MASTER_ANALYSER`. */
  id: string;
  bus: MeterBus | null;
  className?: string;
}

/** Purely visual peak meter (aria-hidden): a static gradient with a cover that the bus scales. */
export function LevelMeter({ id, bus, className }: LevelMeterProps) {
  const coverRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bus || !coverRef.current) return;
    return bus.register(id, coverRef.current, holdRef.current);
  }, [bus, id]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-gradient-to-r from-emerald-500 from-60% via-amber-400 via-85% to-red-500',
        className,
      )}
    >
      <div
        ref={coverRef}
        className="absolute inset-0 origin-right bg-daw-meter"
        style={{ transform: 'scaleX(1)' }}
      />
      <div ref={holdRef} className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: 0 }} />
    </div>
  );
}
