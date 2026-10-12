import { Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultTrack } from '@/types/results';
import { LevelMeter } from './LevelMeter';
import { VolumeFader } from './VolumeFader';
import { dawFocus } from './ui';
import type { MeterBus } from './useMeters';
import type { TrackMix } from './useMixerState';

/** 32 px visual button with a 44 px hit area. */
const HIT = "relative before:absolute before:-inset-1.5 before:content-['']";
const ms = cn(HIT, 'size-8 shrink-0 rounded-md text-xs font-bold transition-colors', dawFocus);
const msOff = 'bg-daw-control text-muted-foreground hover:bg-daw-control-hover hover:text-foreground';
const iconBtn = cn(
  HIT,
  'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-daw-control hover:text-foreground',
  dawFocus,
);

interface TrackHeaderProps {
  track: ResultTrack;
  color: string;
  mix: TrackMix;
  bus: MeterBus | null;
  onVolume: (db: number) => void;
  onMute: () => void;
  onSolo: (exclusive: boolean) => void;
  onDownload: () => void;
  onRemove: () => void;
}

export function TrackHeader({ track, color, mix, bus, onVolume, onMute, onSolo, onDownload, onRemove }: TrackHeaderProps) {
  const origin = track.nodeType === 'Merge' ? `Merge · ${track.nodeLabel}` : `${track.nodeLabel}${track.modelName ? ` · ${track.modelName}` : ''}`;
  return (
    <div className="relative flex min-w-0 flex-col gap-1.5 bg-daw-surface py-2.5 pl-4 pr-3">
      {/* Stem colour strip */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p id={`track-name-${track.id}`} className="truncate text-sm font-semibold text-foreground" title={track.displayName}>
            {track.displayName}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={origin}>{origin}</p>
        </div>
        <button
          type="button"
          onClick={onMute}
          aria-pressed={mix.muted}
          aria-label={`Mute ${track.displayName}`}
          title="Mute (M)"
          className={cn(ms, mix.muted ? 'bg-red-600 text-white hover:bg-red-700' : msOff)}
        >
          M
        </button>
        <button
          type="button"
          onClick={(e) => onSolo(e.altKey)}
          aria-pressed={mix.soloed}
          aria-label={`Solo ${track.displayName}`}
          title="Solo (S) · Alt+click for exclusive solo"
          className={cn(ms, mix.soloed ? 'bg-amber-400 text-zinc-950 hover:bg-amber-300' : msOff)}
        >
          S
        </button>
      </div>
      <VolumeFader label={`${track.displayName} volume`} valueDb={mix.volumeDb} onChange={onVolume} />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <LevelMeter id={track.id} bus={bus} />
        </div>
        <div className="flex w-14 shrink-0 justify-end">
          <button type="button" onClick={onDownload} aria-label={`Download ${track.displayName}`} title="Download" className={iconBtn}>
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${track.displayName} from results`}
            title="Remove from results"
            className={iconBtn}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
