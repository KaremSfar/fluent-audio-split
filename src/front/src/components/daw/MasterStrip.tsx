import { cn } from '@/lib/utils';
import { MASTER_ANALYSER } from '@/components/execution/stemSyncEngine';
import { LevelMeter } from './LevelMeter';
import { VolumeFader } from './VolumeFader';
import type { MeterBus } from './useMeters';

interface MasterStripProps {
  valueDb: number;
  onChange: (db: number) => void;
  bus: MeterBus | null;
  clipped: boolean;
  onResetClip: () => void;
}

export function MasterStrip({ valueDb, onChange, bus, clipped, onResetClip }: MasterStripProps) {
  return (
    <div className="flex min-w-[260px] flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-400">Master</span>
        <VolumeFader label="Master volume" valueDb={valueDb} onChange={onChange} className="flex-1" />
      </div>
      <div className="flex items-center gap-2 pl-14">
        <LevelMeter id={MASTER_ANALYSER} bus={bus} />
        <button
          type="button"
          onClick={onResetClip}
          aria-label={`Clip indicator, ${clipped ? 'clipped' : 'not clipped'}${clipped ? ', press to reset' : ''}`}
          title={clipped ? 'Clipped — click to reset' : 'No clipping'}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1 text-[10px] font-semibold uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <span className={cn('size-2.5 rounded-full', clipped ? 'bg-red-500' : 'bg-zinc-700')} aria-hidden="true" />
          <span className={clipped ? 'text-red-400' : 'text-zinc-400'}>Clip</span>
        </button>
      </div>
    </div>
  );
}
