/**
 * Beat grids: where the click's beats are on the transport timeline.
 *
 * - {@link FixedGrid}: constant tempo from `bpm` + `offsetSec` (beat 0 = the downbeat at offsetSec).
 * - {@link MapGrid}: an explicit list of beat times (from the beat tracker, corrected by anchors).
 *   Beyond either end it extrapolates with the local tempo (median of the nearest 4 intervals).
 *
 * Beats are indexed by integer `k` (may be negative). Bars come from "downbeat refs": beat indices
 * that are beat 1. The first ref fixes the bar phase for everything before the second ref; each
 * later ref restarts the bar phase from that beat on (a downbeat anchor after a tracker glitch or an
 * odd bar), and bar numbers keep counting continuously.
 */

export interface TempoMap {
  /** Beat times (s), strictly increasing. */
  beats: number[];
  /** Index into `beats` of a beat 1. */
  downbeatIndex: number;
  /** Tempo estimate at analysis time (display only). */
  bpm: number;
  /** Tracker confidence 0..1 at analysis time (display only). */
  confidence: number;
}

/**
 * - `beat`: "this is a beat" — moves the nearest map beat onto `pos`.
 * - `downbeat`: same, and that beat is beat 1 from here on.
 * - `bar1`: phase only — the nearest beat is beat 1 from here on; timing untouched.
 */
export type AnchorKind = 'beat' | 'downbeat' | 'bar1';
export interface Anchor {
  pos: number;
  kind: AnchorKind;
}

export interface BeatGrid {
  readonly kind: 'fixed' | 'map';
  readonly beatsPerBar: number;
  /** Transport time of beat k (k integer). Strictly increasing in k. */
  beatTime(k: number): number;
  /** Continuous, monotonic inverse of beatTime (fractional beat index). */
  beatIndexAt(pos: number): number;
  /** 0-based position of beat k within its bar. */
  beatInBar(k: number): number;
  /** 0-based bar number of beat k (bar "1" in the UI is index 0). */
  barIndex(k: number): number;
}

const IDX_EPS = 1e-6;
/** Minimum spacing between map beats after anchor corrections (s). */
const MIN_BEAT_GAP = 0.06;
/** Beats before the first timing anchor over which its correction is faded in. */
const ANCHOR_RAMP_BEATS = 4;
const MAX_MAP_BEATS = 20000;

const mod = (a: number, n: number) => ((a % n) + n) % n;

class BarPhase {
  private readonly refs: number[];
  private readonly starts: number[];
  private readonly B: number;

  constructor(refs: number[], beatsPerBar: number) {
    this.B = Math.max(1, Math.round(beatsPerBar));
    const sorted = [...new Set(refs.filter(Number.isFinite).map(Math.round))].sort((a, b) => a - b);
    this.refs = sorted.length ? sorted : [0];
    this.starts = [0];
    for (let i = 1; i < this.refs.length; i++) {
      const prevLast = this.starts[i - 1] + Math.floor((this.refs[i] - 1 - this.refs[i - 1]) / this.B);
      this.starts.push(prevLast + 1);
    }
  }

  private segment(k: number): number {
    let lo = 0;
    let hi = this.refs.length - 1;
    if (k < this.refs[0]) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.refs[mid] <= k) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  beatInBar(k: number): number {
    return mod(k - this.refs[this.segment(k)], this.B);
  }

  barIndex(k: number): number {
    const s = this.segment(k);
    return this.starts[s] + Math.floor((k - this.refs[s]) / this.B);
  }
}

export class FixedGrid implements BeatGrid {
  readonly kind = 'fixed' as const;
  readonly beatsPerBar: number;
  private readonly spb: number;
  private readonly offset: number;
  private readonly phase: BarPhase;

  constructor(bpm: number, offsetSec: number, beatsPerBar: number) {
    this.spb = 60 / (bpm > 0 ? bpm : 120);
    this.offset = offsetSec;
    this.beatsPerBar = Math.max(1, Math.round(beatsPerBar));
    this.phase = new BarPhase([0], this.beatsPerBar);
  }

  beatTime(k: number): number {
    return this.offset + k * this.spb;
  }

  beatIndexAt(pos: number): number {
    return (pos - this.offset) / this.spb;
  }

  beatInBar(k: number): number {
    return this.phase.beatInBar(k);
  }

  barIndex(k: number): number {
    return this.phase.barIndex(k);
  }
}

function medianInterval(beats: number[], from: number, to: number): number {
  const d: number[] = [];
  for (let i = Math.max(1, from); i < Math.min(beats.length, to); i++) d.push(beats[i] - beats[i - 1]);
  d.sort((a, b) => a - b);
  return d.length ? d[d.length >> 1] : 0.5;
}

export class MapGrid implements BeatGrid {
  readonly kind = 'map' as const;
  readonly beatsPerBar: number;
  readonly beats: readonly number[];
  private readonly headP: number;
  private readonly tailP: number;
  private readonly phase: BarPhase;

  /** `beats` must be strictly increasing with at least 2 entries. */
  constructor(beats: readonly number[], downbeatRefs: number[], beatsPerBar: number) {
    this.beats = beats;
    this.beatsPerBar = Math.max(1, Math.round(beatsPerBar));
    const b = beats as number[];
    this.headP = medianInterval(b, 1, 5);
    this.tailP = medianInterval(b, b.length - 4, b.length);
    this.phase = new BarPhase(downbeatRefs, this.beatsPerBar);
  }

  beatTime(k: number): number {
    const n = this.beats.length;
    if (k < 0) return this.beats[0] + k * this.headP;
    if (k > n - 1) return this.beats[n - 1] + (k - (n - 1)) * this.tailP;
    return this.beats[k];
  }

  beatIndexAt(pos: number): number {
    const b = this.beats;
    const n = b.length;
    if (pos < b[0]) return (pos - b[0]) / this.headP;
    if (pos >= b[n - 1]) return n - 1 + (pos - b[n - 1]) / this.tailP;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid] <= pos) lo = mid;
      else hi = mid;
    }
    return lo + (pos - b[lo]) / (b[hi] - b[lo]);
  }

  beatInBar(k: number): number {
    return this.phase.beatInBar(k);
  }

  barIndex(k: number): number {
    return this.phase.barIndex(k);
  }
}

// ── Grid queries ──────────────────────────────────────────────────────────────

/** Index of the beat at or before `pos` (tolerant of float error at the beat itself). */
export const beatIndexFloor = (g: BeatGrid, pos: number): number => Math.floor(g.beatIndexAt(pos) + IDX_EPS);

/** Seconds per beat around `pos`. */
export function periodAt(g: BeatGrid, pos: number): number {
  const k = beatIndexFloor(g, pos);
  return g.beatTime(k + 1) - g.beatTime(k);
}

export const bpmAt = (g: BeatGrid, pos: number): number => 60 / periodAt(g, pos);

/** 1-based bar and beat at `pos`. */
export function barBeatAt(g: BeatGrid, pos: number): { bar: number; beat: number } {
  const k = beatIndexFloor(g, pos);
  return { bar: g.barIndex(k) + 1, beat: g.beatInBar(k) + 1 };
}

/** Index of beat 1 of the bar containing beat k. */
export const barStartBeat = (g: BeatGrid, k: number): number => k - g.beatInBar(k);

/** `[start, end)` of `bars` bars starting with the bar that contains `pos`. */
export function barRegion(g: BeatGrid, pos: number, bars: number): { start: number; end: number } {
  const k0 = barStartBeat(g, beatIndexFloor(g, pos));
  let k1 = k0;
  for (let i = 0; i < Math.max(1, bars); i++) k1 = nextBarStart(g, k1);
  return { start: g.beatTime(k0), end: g.beatTime(k1) };
}

/** Beat index of the next beat 1 strictly after beat k. */
function nextBarStart(g: BeatGrid, k: number): number {
  for (let j = k + 1; j <= k + 2 * g.beatsPerBar + 1; j++) if (g.beatInBar(j) === 0) return j;
  return k + g.beatsPerBar;
}

/** Time of the nearest bar line to `pos` (for snapping loop edges). */
export function nearestBarLine(g: BeatGrid, pos: number): number {
  const k0 = barStartBeat(g, beatIndexFloor(g, pos));
  const a = g.beatTime(k0);
  const b = g.beatTime(nextBarStart(g, k0));
  return pos - a <= b - pos ? a : b;
}

/** Bar-wise seek target from `pos` (dir −1: start of this bar, or the previous one if already there). */
export function barSeekTarget(g: BeatGrid, pos: number, dir: -1 | 1): number {
  const k0 = barStartBeat(g, beatIndexFloor(g, pos));
  if (dir > 0) return g.beatTime(nextBarStart(g, k0));
  const start = g.beatTime(k0);
  if (pos - start > 0.15) return start;
  return g.beatTime(barStartBeat(g, k0 - 1));
}

// ── Anchors ───────────────────────────────────────────────────────────────────

function nearestIndex(beats: number[], pos: number): number {
  let lo = 0;
  let hi = beats.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= pos) lo = mid;
    else hi = mid;
  }
  return Math.abs(beats[lo] - pos) <= Math.abs(beats[hi] - pos) ? lo : hi;
}

/**
 * Apply anchors to a beat map. Beats are first extended (with the local tempo) to cover anchors
 * outside the map; each timing anchor then snaps its nearest beat onto the anchor, corrections are
 * interpolated linearly between consecutive anchors, held after the last one, and faded in over the
 * 4 beats before the first one. Returns the corrected beats and the downbeat refs (base + anchors).
 */
export function applyAnchors(
  map: Pick<TempoMap, 'beats' | 'downbeatIndex'>,
  anchors: readonly Anchor[],
): { beats: number[]; downbeatRefs: number[] } {
  let beats = map.beats.slice();
  let base = map.downbeatIndex;
  if (beats.length < 2 || anchors.length === 0) return { beats, downbeatRefs: [base] };

  // Extend to cover anchors beyond the ends.
  const lo = Math.min(...anchors.map((a) => a.pos));
  const hi = Math.max(...anchors.map((a) => a.pos));
  const headP = medianInterval(beats, 1, 5);
  const tailP = medianInterval(beats, beats.length - 4, beats.length);
  const pre: number[] = [];
  for (let t = beats[0] - headP; t > lo - headP / 2 && pre.length < MAX_MAP_BEATS; t -= headP) pre.unshift(t);
  const post: number[] = [];
  for (let t = beats[beats.length - 1] + tailP; t < hi + tailP / 2 && post.length < MAX_MAP_BEATS; t += tailP) post.push(t);
  if (pre.length || post.length) {
    beats = [...pre, ...beats, ...post];
    base += pre.length;
  }
  const raw = beats.slice();

  // Timing anchors: latest added wins when two snap to the same beat.
  const byIdx = new Map<number, { idx: number; d: number; downbeat: boolean }>();
  for (const a of anchors) {
    if (a.kind === 'bar1') continue;
    const idx = nearestIndex(raw, a.pos);
    byIdx.set(idx, { idx, d: a.pos - raw[idx], downbeat: a.kind === 'downbeat' });
  }
  const timing = [...byIdx.values()].sort((a, b) => a.idx - b.idx);
  if (timing.length) {
    const first = timing[0];
    for (let j = 1; j <= ANCHOR_RAMP_BEATS && first.idx - j >= 0; j++) {
      beats[first.idx - j] += (first.d * (ANCHOR_RAMP_BEATS - j)) / ANCHOR_RAMP_BEATS;
    }
    for (let a = 0; a < timing.length; a++) {
      const A = timing[a];
      const Bn = timing[a + 1];
      const end = Bn ? Bn.idx : beats.length;
      for (let i = A.idx; i < end; i++) {
        const f = Bn ? (i - A.idx) / (Bn.idx - A.idx) : 0;
        beats[i] = raw[i] + A.d + f * ((Bn?.d ?? A.d) - A.d);
      }
    }
    // Conflicting anchors must never fold the timeline back on itself.
    for (let i = 1; i < beats.length; i++) if (beats[i] < beats[i - 1] + MIN_BEAT_GAP) beats[i] = beats[i - 1] + MIN_BEAT_GAP;
  }

  // A user-set beat 1 overrides the analysis guess everywhere (its phase extends backwards); each
  // further one re-phases the bars from that beat on.
  const anchorRefs: number[] = [];
  for (const t of timing) if (t.downbeat) anchorRefs.push(t.idx);
  for (const a of anchors) if (a.kind === 'bar1') anchorRefs.push(nearestIndex(beats, a.pos));
  return { beats, downbeatRefs: anchorRefs.length ? anchorRefs : [base] };
}

// ── Map edits ─────────────────────────────────────────────────────────────────

export function halfTime(map: TempoMap): TempoMap {
  if (map.beats.length < 4) return map;
  const p = map.downbeatIndex % 2;
  return {
    ...map,
    beats: map.beats.filter((_, i) => i % 2 === p),
    downbeatIndex: (map.downbeatIndex - p) / 2,
    bpm: Math.round((map.bpm / 2) * 10) / 10,
  };
}

export function doubleTime(map: TempoMap): TempoMap {
  const b = map.beats;
  if (b.length < 2 || b.length * 2 > MAX_MAP_BEATS) return map;
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    const next = i + 1 < b.length ? b[i + 1] : b[i] + (b[i] - b[i - 1]);
    out.push((b[i] + next) / 2);
  }
  return { ...map, beats: out, downbeatIndex: map.downbeatIndex * 2, bpm: Math.round(map.bpm * 2 * 10) / 10 };
}

export function shiftMap(map: TempoMap, deltaSec: number): TempoMap {
  return { ...map, beats: map.beats.map((t) => Math.round((t + deltaSec) * 1e4) / 1e4) };
}

/** Sanitize a persisted map: finite, strictly increasing, ≥ 2 beats; else null. */
export function sanitizeMap(m: unknown): TempoMap | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (!Array.isArray(o.beats) || o.beats.length < 2 || o.beats.length > MAX_MAP_BEATS) return null;
  const beats: number[] = [];
  for (const t of o.beats) {
    if (typeof t !== 'number' || !Number.isFinite(t)) return null;
    if (beats.length && t <= beats[beats.length - 1]) return null;
    beats.push(t);
  }
  const di = typeof o.downbeatIndex === 'number' && Number.isInteger(o.downbeatIndex) ? o.downbeatIndex : 0;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    beats,
    downbeatIndex: Math.max(0, Math.min(beats.length - 1, di)),
    bpm: num(o.bpm, 60 / medianInterval(beats, 1, beats.length)),
    confidence: Math.max(0, Math.min(1, num(o.confidence, 0))),
  };
}

export function sanitizeAnchors(v: unknown): Anchor[] {
  if (!Array.isArray(v)) return [];
  const out: Anchor[] = [];
  for (const a of v.slice(0, 500)) {
    if (!a || typeof a !== 'object') continue;
    const { pos, kind } = a as Record<string, unknown>;
    if (typeof pos !== 'number' || !Number.isFinite(pos)) continue;
    if (kind !== 'beat' && kind !== 'downbeat' && kind !== 'bar1') continue;
    out.push({ pos, kind });
  }
  return out;
}

/** The grid the click follows: the (anchor-corrected) beat map in Follow mode, else the fixed grid. */
export function buildGrid(s: {
  mode: 'fixed' | 'follow';
  bpm: number;
  offsetSec: number;
  beatsPerBar: number;
  map: TempoMap | null;
  anchors: readonly Anchor[];
}): BeatGrid {
  if (s.mode === 'follow' && s.map && s.map.beats.length >= 2) {
    const { beats, downbeatRefs } = applyAnchors(s.map, s.anchors);
    return new MapGrid(beats, downbeatRefs, s.beatsPerBar);
  }
  return new FixedGrid(s.bpm, s.offsetSec, s.beatsPerBar);
}
