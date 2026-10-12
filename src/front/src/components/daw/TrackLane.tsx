import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StemWaveformPlayer } from '@/components/execution/StemWaveformPlayer';
import type { StemSyncEngine } from '@/components/execution/stemSyncEngine';
import type { ResultTrack } from '@/types/results';
import { TrackHeader } from './TrackHeader';
import { stemColor } from './stemColor';
import type { MeterBus } from './useMeters';
import type { TrackMix } from './useMixerState';

interface TrackLaneProps {
  track: ResultTrack;
  index: number;
  engine: StemSyncEngine;
  bus: MeterBus | null;
  mix: TrackMix;
  audible: boolean;
  /** Canvas deep link used by the failed-lane "Retry on canvas" action. */
  canvasHref: string;
  onFocusTrack: (id: string) => void;
  onVolume: (db: number) => void;
  onMute: () => void;
  onSolo: (exclusive: boolean) => void;
  onDownload: () => void;
  onRemove: () => void;
  onRetryLoad: () => void;
}

const laneFocus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400';

/** One arrange-view lane: channel header (300 px) + waveform. Handles pending/failed placeholders. */
export function TrackLane(props: TrackLaneProps) {
  const { track, index, engine, bus, mix, audible, canvasHref, onFocusTrack } = props;
  const color = stemColor(track.outputName, track.nodeType);
  const ready = track.state === 'Ready' && !!track.artifactPath;

  return (
    <div
      role="group"
      aria-labelledby={`track-name-${track.id}`}
      tabIndex={-1}
      data-track-lane={index}
      onFocus={() => onFocusTrack(track.id)}
      className={cn(
        'grid grid-cols-1 border-t border-zinc-800 md:grid-cols-[300px_minmax(0,1fr)]',
        laneFocus,
        ready && !audible && 'opacity-50',
      )}
    >
      {ready ? (
        <TrackHeader
          track={track}
          color={color}
          mix={mix}
          bus={bus}
          onVolume={props.onVolume}
          onMute={props.onMute}
          onSolo={props.onSolo}
          onDownload={props.onDownload}
          onRemove={props.onRemove}
        />
      ) : (
        <div className="flex items-start gap-2 bg-zinc-900 px-3 py-2">
          <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p id={`track-name-${track.id}`} className="truncate text-sm font-medium text-zinc-100">{track.displayName}</p>
            <p className="truncate text-xs text-zinc-400">{track.nodeLabel}</p>
          </div>
          <button
            type="button"
            onClick={props.onRemove}
            aria-label={`Remove ${track.displayName} from results`}
            title="Remove from results"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-[88px] items-center bg-zinc-950 px-2 py-2">
        {ready ? (
          <StemWaveformPlayer
            id={track.id}
            path={track.artifactPath!}
            engine={engine}
            variant="dark"
            color={color}
            onRetry={props.onRetryLoad}
          />
        ) : track.state === 'Pending' ? (
          <div className="flex h-[72px] flex-1 animate-pulse items-center rounded bg-zinc-900 px-3 text-sm text-zinc-400 motion-reduce:animate-none">
            Waiting for {track.nodeLabel}…
          </div>
        ) : (
          <div className="flex min-h-[72px] flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded bg-red-950/60 px-3 text-sm text-red-200">
            <span>
              {track.displayName} ({track.nodeLabel}){' '}
              {track.state === 'Failed'
                ? `failed${track.errorMessage ? `: ${track.errorMessage}` : ''}`
                : track.state === 'Cancelled'
                  ? 'was cancelled'
                  : 'did not produce this stem'}
            </span>
            <Link
              to={canvasHref}
              className="rounded border border-red-300/60 px-2 py-0.5 text-xs hover:bg-red-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
            >
              Retry on canvas
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
