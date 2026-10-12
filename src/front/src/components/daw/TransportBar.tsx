import { Loader2, Pause, Play, Repeat, Square, SkipBack, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LoopRegion, StemSyncEngine } from '@/components/execution/stemSyncEngine';
import { barBeatAt, bpmAt, type BeatGrid } from './beatGrid';
import type { MetronomeSettings } from './metronome';
import { formatClock, prefersReducedMotion, useTransportPos } from './useTransportPos';
import { Divider } from './Divider';
import { caption, ctl, ctlIcon, dawFocus, neutral } from './ui';

interface TransportBarProps {
  engine: StemSyncEngine;
  playing: boolean;
  loading: boolean;
  duration: number;
  metronome: MetronomeSettings;
  grid: BeatGrid;
  /** Gap-click silence at a position (for the visual cue). */
  isGapSilentAt: (pos: number) => boolean;
  loop: LoopRegion | null;
  onLoopBars: (bars: number) => void;
  onClearLoop: () => void;
  onPlayPause: () => void;
  onStop: () => void;
  onToStart: () => void;
  /** Master section (right end of the main row). */
  master: React.ReactNode;
  /** Metronome controls (second row). */
  children: React.ReactNode;
}

/** Sticky transport: shared play/stop/seek, clock, bar·beat readout, loop, then the metronome/master controls. */
export function TransportBar({
  engine,
  playing,
  loading,
  duration,
  metronome,
  grid,
  isGapSilentAt,
  loop,
  onLoopBars,
  onClearLoop,
  onPlayPause,
  onStop,
  onToStart,
  master,
  children,
}: TransportBarProps) {
  const pos = useTransportPos(engine);
  const { bar, beat } = barBeatAt(grid, pos);
  const silent = metronome.enabled && playing && isGapSilentAt(pos);
  const hideBeat = silent && !metronome.gap.visualCue;
  const dots = prefersReducedMotion() || !playing || hideBeat ? -1 : beat;
  const follow = metronome.mode === 'follow';

  return (
    <div className="sticky top-0 z-20 border-b border-daw-border bg-daw-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        {/* Transport */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Transport">
          <button type="button" onClick={onToStart} className={cn(ctlIcon, 'size-9', neutral)} aria-label="Return to start" title="Return to start (Enter / Home)">
            <SkipBack className="size-4" />
          </button>
          <button
            type="button"
            onClick={onPlayPause}
            className={cn(
              'inline-flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90',
              dawFocus,
            )}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {loading && !playing ? (
              <Loader2 className="size-5 animate-spin" />
            ) : playing ? (
              <Pause className="size-5" fill="currentColor" />
            ) : (
              <Play className="ml-0.5 size-5" fill="currentColor" />
            )}
          </button>
          <button type="button" onClick={onStop} className={cn(ctlIcon, 'size-9', neutral)} aria-label="Stop" title="Stop">
            <Square className="size-3.5" fill="currentColor" />
          </button>
        </div>

        {/* Clock + bar/beat */}
        <div className="flex min-w-[190px] flex-col justify-center">
          <p className="font-mono text-xl font-medium leading-tight tabular-nums text-foreground" aria-label="Playback position">
            {formatClock(pos)} <span className="text-sm font-normal text-muted-foreground">/ {formatClock(duration)}</span>
          </p>
          <div className="flex h-4 items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums" aria-hidden={!metronome.enabled}>
              {metronome.enabled ? `Bar ${bar} · ${beat}` : 'Click off'}
            </span>
            {metronome.enabled && (
              <span className={cn('flex gap-1', hideBeat && 'opacity-30')} aria-hidden="true">
                {Array.from({ length: metronome.beatsPerBar }, (_, i) => {
                  const level = metronome.accents[i] ?? (i === 0 ? 2 : 1);
                  const lit = dots === i + 1;
                  return (
                    <span
                      key={i}
                      className={cn(
                        'size-2 rounded-full',
                        level === 0
                          ? cn('border', lit ? 'border-foreground' : 'border-muted-foreground/50')
                          : lit
                            ? level === 2
                              ? 'bg-primary dark:bg-daw-bar'
                              : 'bg-foreground'
                            : level === 2
                              ? 'bg-primary/30 dark:bg-daw-bar/30'
                              : 'bg-daw-control-hover',
                      )}
                    />
                  );
                })}
              </span>
            )}
            {silent && (
              <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                Gap
              </span>
            )}
            {metronome.enabled && follow && (
              <span className="tabular-nums" title="Tempo at the playhead (follows the song)">≈{bpmAt(grid, Math.max(0, pos)).toFixed(1)} BPM</span>
            )}
          </div>
        </div>

        <Divider />

        {/* Loop */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Loop">
          <span className={cn(caption, 'mr-0.5 flex items-center gap-1')}>
            <Repeat className="size-3.5" aria-hidden="true" /> Loop
          </span>
          <button type="button" onClick={() => onLoopBars(1)} className={cn(ctl, neutral)} title="Loop the bar at the playhead (L)">
            1 bar
          </button>
          <button type="button" onClick={() => onLoopBars(4)} className={cn(ctl, neutral)} title="Loop 4 bars from the bar at the playhead (Shift+L)">
            4 bars
          </button>
          {loop && (
            <button
              type="button"
              onClick={onClearLoop}
              className={cn(ctl, 'bg-primary/15 font-mono tabular-nums text-foreground ring-1 ring-inset ring-primary/40 hover:bg-primary/25')}
              aria-label={`Loop on, ${formatClock(loop.start)} to ${formatClock(loop.end)}. Turn loop off`}
              title="Loop off (L)"
            >
              {formatClock(loop.start).slice(0, 8)}–{formatClock(loop.end).slice(0, 8)} <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex flex-1 justify-end">{master}</div>
      </div>

      <div className="border-t border-daw-border px-4 py-2.5">{children}</div>
    </div>
  );
}
