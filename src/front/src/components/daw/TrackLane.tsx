import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StemWaveformPlayer } from '@/components/execution/StemWaveformPlayer';
import type { StemSyncEngine } from '@/components/execution/stemSyncEngine';
import type { ResultTrack } from '@/types/results';
import { TrackHeader } from './TrackHeader';
import { stemColor } from './stemColor';
import { dawFocus } from './ui';
import { useTheme } from '@/theme/useTheme';
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
  /** The page draws one shared playhead over the lanes (wide layouts); otherwise each lane shows its own. */
  sharedPlayhead: boolean;
}

const laneFocus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

/** One arrange-view lane: channel header (300 px) + waveform. Handles pending/failed placeholders. */
export function TrackLane(props: TrackLaneProps) {
  const { track, index, engine, bus, mix, audible, canvasHref, onFocusTrack } = props;
  const { theme } = useTheme();
  const color = stemColor(track.outputName, track.nodeType, theme);
  const ready = track.state === 'Ready' && !!track.artifactPath;

  return (
    <div
      role="group"
      aria-labelledby={`track-name-${track.id}`}
      tabIndex={-1}
      data-track-lane={index}
      onFocus={() => onFocusTrack(track.id)}
      className={cn(
        'grid grid-cols-1 border-b border-daw-border md:grid-cols-[300px_minmax(0,1fr)]',
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
        <div className="relative flex items-start gap-2 bg-daw-surface py-2.5 pl-4 pr-3">
          <span className="absolute inset-y-0 left-0 w-1 opacity-50" style={{ backgroundColor: color }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p id={`track-name-${track.id}`} className="truncate text-sm font-semibold text-foreground">{track.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{track.nodeLabel}</p>
          </div>
          <button
            type="button"
            onClick={props.onRemove}
            aria-label={`Remove ${track.displayName} from results`}
            title="Remove from results"
            className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-daw-control hover:text-foreground', dawFocus)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-[96px] items-center bg-daw-lane px-2 py-3">
        {ready ? (
          <StemWaveformPlayer
            id={track.id}
            path={track.artifactPath!}
            engine={engine}
            variant="studio"
            color={color}
            cursor={!props.sharedPlayhead}
            onRetry={props.onRetryLoad}
          />
        ) : track.state === 'Pending' ? (
          <div className="flex h-[72px] flex-1 animate-pulse items-center rounded-md bg-daw-control px-3 text-sm text-muted-foreground motion-reduce:animate-none">
            Waiting for {track.nodeLabel}…
          </div>
        ) : (
          <div className="flex min-h-[72px] flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-red-200 bg-red-50 px-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200">
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
              className={cn('rounded-md border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100 dark:border-red-300/60 dark:hover:bg-red-950', dawFocus)}
            >
              Retry on canvas
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
