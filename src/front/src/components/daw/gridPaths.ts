import { beatIndexFloor, type BeatGrid } from './beatGrid';

const MIN_TICK_PX = 4;

/** Bar/beat tick paths for the visible song, in pixel space (works for fixed grids and tempo maps). */
export function gridPaths(
  grid: BeatGrid,
  duration: number,
  width: number,
  y: { bar: string; beat: string } = { bar: '17V32', beat: '24V32' },
): { bars: string; beats: string } {
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
    if (grid.beatInBar(k) === 0) bars += `M${x} ${y.bar}`;
    else if (drawBeats) beats += `M${x} ${y.beat}`;
  }
  return { bars, beats };
}
