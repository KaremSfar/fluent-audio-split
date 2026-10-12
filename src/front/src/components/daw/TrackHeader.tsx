import { Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultTrack } from '@/types/results';
import { LevelMeter } from './LevelMeter';
import { VolumeFader } from './VolumeFader';
import type { MeterBus } from './useMeters';
import type { TrackMix } from './useMixerState';

/** 32 px visual button with a 44 px hit area. */
const HIT = "relative before:absolute before:-inset-1.5 before:content-['']";

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
    <div className="flex min-w-0 flex-col gap-1.5 bg-zinc-900 px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p id={`track-name-${track.id}`} className="truncate text-sm font-medium text-zinc-100" title={track.displayName}>
            {track.displayName}
          </p>
          <p className="truncate text-xs text-zinc-400" title={origin}>{origin}</p>
        </div>
        <button
          type="button"
          onClick={onMute}
          aria-pressed={mix.muted}
          aria-label={`Mute ${track.displayName}`}
          title="Mute (M)"
          className={cn(
            HIT,
            'size-8 shrink-0 rounded text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900',
            mix.muted ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700',
          )}
        >
          M
        </button>
        <button
          type="button"
          onClick={(e) => onSolo(e.altKey)}
          aria-pressed={mix.soloed}
          aria-label={`Solo ${track.displayName}`}
          title="Solo (S) · Alt+click for exclusive solo"
          className={cn(
            HIT,
            'size-8 shrink-0 rounded text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900',
            mix.soloed ? 'bg-amber-400 text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700',
          )}
        >
          S
        </button>
      </div>
      <VolumeFader label={`${track.displayName} volume`} valueDb={mix.volumeDb} onChange={onVolume} />
      <div className="flex items-center gap-2">
        <LevelMeter id={track.id} bus={bus} />
        <button
          type="button"
          onClick={onDownload}
          aria-label={`Download ${track.displayName}`}
          title="Download"
          className={cn(HIT, 'inline-flex size-7 shrink-0 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400')}
        >
          <Download className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${track.displayName} from results`}
          title="Remove from results"
          className={cn(HIT, 'inline-flex size-7 shrink-0 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400')}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
