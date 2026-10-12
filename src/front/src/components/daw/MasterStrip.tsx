import { cn } from '@/lib/utils';
import { MASTER_ANALYSER } from '@/components/execution/stemSyncEngine';
import { LevelMeter } from './LevelMeter';
import { VolumeFader } from './VolumeFader';
import { dawFocus } from './ui';
import type { MeterBus } from './useMeters';

interface MasterStripProps {
  valueDb: number;
  onChange: (db: number) => void;
  bus: MeterBus | null;
  clipped: boolean;
  onResetClip: () => void;
}

/** Master section of the transport: fader with its meter underneath, plus a latching clip LED. */
export function MasterStrip({ valueDb, onChange, bus, clipped, onResetClip }: MasterStripProps) {
  return (
    <div className="flex w-full min-w-[240px] max-w-[320px] items-center gap-3" role="group" aria-label="Master">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">Master</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <VolumeFader label="Master volume" valueDb={valueDb} onChange={onChange} />
        <div className="pr-16">
          <LevelMeter id={MASTER_ANALYSER} bus={bus} />
        </div>
      </div>
      <button
        type="button"
        onClick={onResetClip}
        aria-label={`Clip indicator, ${clipped ? 'clipped' : 'not clipped'}${clipped ? ', press to reset' : ''}`}
        title={clipped ? 'Clipped — click to reset' : 'No clipping'}
        className={cn(
          'inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide',
          dawFocus,
          clipped ? 'bg-red-600 text-white' : 'text-muted-foreground hover:bg-daw-control',
        )}
      >
        <span className={cn('size-2 rounded-full', clipped ? 'bg-white' : 'bg-daw-control-hover')} aria-hidden="true" />
        Clip
      </button>
    </div>
  );
}
