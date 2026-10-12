import { Loader2, Pause, Play, Repeat, Square, SkipBack, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LoopRegion, StemSyncEngine } from '@/components/execution/stemSyncEngine';
import { barBeatAt, bpmAt, type BeatGrid } from './beatGrid';
import type { MetronomeSettings } from './metronome';
import { formatClock, prefersReducedMotion, useTransportPos } from './useTransportPos';

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
  /** Metronome and master controls. */
  children: React.ReactNode;
}

const btn =
  'inline-flex size-10 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900';
const small =
  'inline-flex h-7 items-center gap-1 rounded px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400';

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
  children,
}: TransportBarProps) {
  const pos = useTransportPos(engine);
  const { bar, beat } = barBeatAt(grid, pos);
  const silent = metronome.enabled && playing && isGapSilentAt(pos);
  const hideBeat = silent && !metronome.gap.visualCue;
  const dots = prefersReducedMotion() || !playing || hideBeat ? -1 : beat;
  const follow = metronome.mode === 'follow';

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-zinc-800 bg-zinc-900 px-3 py-3 text-zinc-100">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onToStart} className={cn(btn, 'bg-zinc-800 hover:bg-zinc-700')} aria-label="Return to start" title="Return to start (Enter / Home)">
            <SkipBack className="size-4" />
          </button>
          <button
            type="button"
            onClick={onPlayPause}
            className={cn(btn, 'bg-violet-500 text-white hover:bg-violet-600')}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {loading && !playing ? <Loader2 className="size-4 animate-spin" /> : playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button type="button" onClick={onStop} className={cn(btn, 'bg-zinc-800 hover:bg-zinc-700')} aria-label="Stop" title="Stop">
            <Square className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Loop">
          <button
            type="button"
            onClick={() => onLoopBars(1)}
            className={cn(small, 'bg-zinc-800 hover:bg-zinc-700')}
            title="Loop the bar at the playhead (L)"
          >
            <Repeat className="size-3" aria-hidden="true" /> Bar
          </button>
          <button
            type="button"
            onClick={() => onLoopBars(4)}
            className={cn(small, 'bg-zinc-800 hover:bg-zinc-700')}
            title="Loop 4 bars from the bar at the playhead (Shift+L)"
          >
            4 bars
          </button>
          {loop && (
            <button
              type="button"
              onClick={onClearLoop}
              className={cn(small, 'bg-violet-500/30 text-violet-100 hover:bg-violet-500/50')}
              aria-label={`Loop on, ${formatClock(loop.start)} to ${formatClock(loop.end)}. Turn loop off`}
              title="Loop off (L)"
            >
              {formatClock(loop.start).slice(0, 8)}–{formatClock(loop.end).slice(0, 8)} <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col justify-center">
        <p className="font-mono text-lg tabular-nums" aria-label="Playback position">
          {formatClock(pos)} <span className="text-sm text-zinc-400">/ {formatClock(duration)}</span>
        </p>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
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
                      'size-1.5 rounded-full',
                      level === 0 ? 'border border-zinc-600' : lit ? (level === 2 ? 'bg-violet-300' : 'bg-zinc-200') : level === 2 ? 'bg-violet-900' : 'bg-zinc-700',
                      lit && level === 0 && 'border-zinc-300',
                    )}
                  />
                );
              })}
            </span>
          )}
          {silent && <span className="rounded bg-zinc-800 px-1 text-[10px] uppercase tracking-wide text-amber-300">Gap</span>}
          {metronome.enabled && follow && (
            <span className="tabular-nums" title="Tempo at the playhead (follows the song)">≈{bpmAt(grid, Math.max(0, pos)).toFixed(1)} BPM</span>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
