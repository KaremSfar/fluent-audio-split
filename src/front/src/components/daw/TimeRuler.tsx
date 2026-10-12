import { useEffect, useMemo, useRef, useState } from 'react';
import type { LoopRegion, StemSyncEngine } from '@/components/execution/stemSyncEngine';
import { beatIndexFloor, type Anchor, type BeatGrid } from './beatGrid';
import { useTransportPos } from './useTransportPos';

interface TimeRulerProps {
  engine: StemSyncEngine;
  duration: number;
  grid: BeatGrid;
  /** Draw bar/beat ticks (click on). */
  showGrid: boolean;
  /** Anchors to mark (Follow mode). */
  anchors: readonly Anchor[];
  loop: LoopRegion | null;
  /** Shift+click: set the nearer loop edge at this position (the page snaps it to a bar line). */
  onLoopEdge: (pos: number) => void;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MIN_TICK_PX = 4;
const label = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Bar/beat tick paths for the visible song, in pixel space (works for fixed grids and tempo maps). */
function gridPaths(grid: BeatGrid, duration: number, width: number): { bars: string; beats: string } {
  const empty = { bars: '', beats: '' };
  if (duration <= 0 || width <= 0) return empty;
  const k0 = Math.max(beatIndexFloor(grid, 0), -100000);
  const k1 = Math.min(Math.ceil(grid.beatIndexAt(duration)), k0 + 50000);
  const n = k1 - k0;
  if (n <= 0) return empty;
  const avgBeatSec = (grid.beatTime(k1) - grid.beatTime(k0)) / n;
  const beatPx = (avgBeatSec / duration) * width;
  const drawBeats = beatPx >= MIN_TICK_PX;
  const drawBars = beatPx * grid.beatsPerBar >= MIN_TICK_PX;
  if (!drawBars) return empty;
  let bars = '';
  let beats = '';
  for (let k = k0; k <= k1; k++) {
    const t = grid.beatTime(k);
    if (t < 0 || t > duration) continue;
    const x = ((t / duration) * width).toFixed(1);
    if (grid.beatInBar(k) === 0) bars += `M${x} 16V28`;
    else if (drawBeats) beats += `M${x} 22V28`;
  }
  return { bars, beats };
}

/** Time ruler (click/drag to seek, Shift+click for loop edges) with playhead, bar/beat grid, loop band and anchors. */
export function TimeRuler({ engine, duration, grid, showGrid, anchors, loop, onLoopEdge }: TimeRulerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const pos = useTransportPos(engine);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const posFromX = (clientX: number) => {
    const el = ref.current;
    if (!el || duration <= 0) return null;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
  };

  const ticks: number[] = [];
  if (duration > 0 && width > 0) {
    const step = STEPS.find((s) => (s / duration) * width >= 70) ?? STEPS[STEPS.length - 1];
    for (let t = 0; t <= duration; t += step) ticks.push(t);
  }

  const paths = useMemo(() => (showGrid ? gridPaths(grid, duration, width) : null), [showGrid, grid, duration, width]);
  const pct = (t: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);

  return (
    <div
      ref={ref}
      role="presentation"
      onPointerDown={(e) => {
        const p = posFromX(e.clientX);
        if (p == null) return;
        if (e.shiftKey) {
          onLoopEdge(p);
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        engine.seek(p);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const p = posFromX(e.clientX);
        if (p != null) engine.seek(p);
      }}
      className="relative h-7 cursor-pointer select-none bg-zinc-900"
      title="Click to seek · Shift+click to set a loop edge (snapped to the nearest bar line)"
    >
      {loop && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 border-x border-violet-400 bg-violet-500/20"
          style={{ left: `${pct(loop.start)}%`, width: `${pct(loop.end) - pct(loop.start)}%` }}
        />
      )}
      {paths && width > 0 && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} 28`} preserveAspectRatio="none">
          <path d={paths.beats} stroke="rgba(161,161,170,0.6)" strokeWidth={1} />
          <path d={paths.bars} stroke="rgba(167,139,250,0.9)" strokeWidth={1} />
        </svg>
      )}
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute top-0 h-full border-l border-zinc-700 pl-1 text-[10px] leading-7 text-zinc-400"
          style={{ left: `${(t / duration) * 100}%` }}
          aria-hidden="true"
        >
          {label(t)}
        </span>
      ))}
      {anchors.map((a) => (
        <span
          key={`${a.kind}:${a.pos}`}
          aria-hidden="true"
          className={`pointer-events-none absolute top-0 -translate-x-1/2 text-[9px] font-bold leading-none ${a.kind === 'beat' ? 'text-amber-300' : 'text-violet-300'}`}
          style={{ left: `${pct(a.pos)}%` }}
        >
          {a.kind === 'beat' ? '▼' : '1'}
        </span>
      ))}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-px bg-zinc-100"
        style={{ left: `${pct(pos)}%` }}
      />
    </div>
  );
}
