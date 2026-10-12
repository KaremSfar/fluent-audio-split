import type { LoopRegion, StemSyncEngine, TransportChange, TransportSnapshot } from '@/components/execution/stemSyncEngine';
import { dbToGain } from './gain';
import { FixedGrid, barBeatAt, beatIndexFloor, buildGrid, type Anchor, type BeatGrid, type TempoMap } from './beatGrid';

/** off / normal / accent, per beat of the bar. */
export type AccentLevel = 0 | 1 | 2;
/** Clicks per beat: 1 = quarters, 2 = 8ths, 3 = triplets, 4 = 16ths. */
export type Subdivision = 1 | 2 | 3 | 4;
/** `fixed`: constant BPM + offset. `follow`: the analysed beat map (+ anchors). */
export type MetronomeMode = 'fixed' | 'follow';

export interface GapConfig {
  enabled: boolean;
  /** Bars with click, then `offBars` silent bars, repeating from the bar where playback started. */
  onBars: number;
  offBars: number;
  /** Keep the visual beat (dots/flash) going during silent bars. */
  visualCue: boolean;
}

export interface MetronomeSettings {
  enabled: boolean;
  bpm: number;
  beatsPerBar: number;
  offsetSec: number;
  volumeDb: number;
  countInBars: 0 | 1 | 2;
  mode: MetronomeMode;
  map: TempoMap | null;
  anchors: Anchor[];
  subdivision: Subdivision;
  /** Length === beatsPerBar (sanitized by the mixer reducer; missing entries fall back to the default). */
  accents: AccentLevel[];
  gap: GapConfig;
  /** Screen-edge flash on each beat (never with prefers-reduced-motion). */
  flash: boolean;
}

export const BEATS_PER_BAR_MIN = 1;
export const BEATS_PER_BAR_MAX = 12;
export const BPM_MIN = 20;
export const BPM_MAX = 300;

export const defaultAccents = (n: number): AccentLevel[] =>
  Array.from({ length: Math.max(1, n) }, (_, i) => (i === 0 ? 2 : 1));

/** Resize an accent pattern to `n` beats, keeping the existing prefix. */
export function resizeAccents(a: readonly AccentLevel[], n: number): AccentLevel[] {
  const d = defaultAccents(n);
  return d.map((v, i) => (i < a.length ? a[i] : v));
}

export const DEFAULT_GAP: GapConfig = { enabled: false, onBars: 2, offBars: 2, visualCue: true };

export const DEFAULT_METRONOME: MetronomeSettings = {
  enabled: false,
  bpm: 120,
  beatsPerBar: 4,
  offsetSec: 0,
  volumeDb: -6,
  countInBars: 0,
  mode: 'fixed',
  map: null,
  anchors: [],
  subdivision: 1,
  accents: defaultAccents(4),
  gap: DEFAULT_GAP,
  flash: false,
};

/** The slice of the engine the metronome needs (lets tests drive it with a fake clock). */
export type MetronomeEngine = Pick<StemSyncEngine, 'context' | 'getTransport' | 'onTransportChange'>;

export type ClickKind = 'accent' | 'normal' | 'sub';

const TICK_MS = 25;
const LOOKAHEAD_SEC = 0.1;
// Background tabs throttle timers to >= 1 s, so schedule further ahead while hidden.
const HIDDEN_LOOKAHEAD_SEC = 1.2;
const CLICK_SEC = 0.03;
const SUB_CLICK_SEC = 0.02;
const ACCENT_HZ = 1500;
const NORMAL_HZ = 1000;
const SUB_HZ = 2000;
const ACCENT_BOOST = Math.pow(10, 3 / 20);
const SUB_CUT = Math.pow(10, -9 / 20);
const BASE_AMP = 0.7;
const EPS = 1e-9;
/** Start a little after the bar line still counts as "starting at that bar" for the gap cycle. */
const GAP_START_TOLERANCE = 0.05;
const MAX_CLICKS_PER_TICK = 2000;

interface Scheduled {
  source: AudioBufferSourceNode;
  when: number;
}

interface ClickKit {
  ctx: AudioContext;
  out: GainNode;
  buffers: Record<ClickKind, AudioBuffer>;
}

interface CountInPlan {
  /** Number of count-in clicks. */
  n: number;
  /** First grid beat at/after the start position (the stems' first beat). */
  k0: number;
  /** Count-in beat period = the tempo at the start. */
  spb: number;
}

function renderClick(ctx: AudioContext, hz: number, amp: number, seconds = CLICK_SEC): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.max(1, Math.round(seconds * rate));
  const buf = ctx.createBuffer(1, n, rate);
  const data = buf.getChannelData(0);
  const tau = seconds / 6;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    data[i] = amp * Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / tau);
  }
  return buf;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Whether bar `barIndex` is silent in a gap-click cycle that started at bar `anchorBar`. */
export function gapSilent(barIndex: number, anchorBar: number, g: GapConfig): boolean {
  if (!g.enabled || g.offBars <= 0) return false;
  return mod(barIndex - anchorBar, Math.max(1, g.onBars) + g.offBars) >= Math.max(1, g.onBars);
}

/** Which click (if any) sounds for sub-tick `j` of beat-in-bar `b`. Subdivision ticks ignore the accent pattern. */
export function clickKind(b: number, j: number, accents: readonly AccentLevel[]): ClickKind | null {
  if (j > 0) return 'sub';
  const lvl = accents[b] ?? (b === 0 ? 2 : 1);
  return lvl === 2 ? 'accent' : lvl === 1 ? 'normal' : null;
}

/**
 * Split a raw (unwrapped) transport window into linear pieces of the song: `pos = raw − shift`.
 * Without a loop (or before its end) that's one identity piece; past the loop end, every lap of
 * the loop is a piece mapped back onto `[start, end)`.
 */
export function loopSegments(
  rawLo: number,
  rawHi: number,
  loop: LoopRegion | null | undefined,
): { from: number; to: number; shift: number }[] {
  const len = loop ? loop.end - loop.start : 0;
  if (!loop || len <= 0 || rawHi <= loop.end) return [{ from: rawLo, to: rawHi, shift: 0 }];
  const out: { from: number; to: number; shift: number }[] = [];
  if (rawLo < loop.end) out.push({ from: rawLo, to: loop.end, shift: 0 });
  for (let c = rawLo < loop.end ? 0 : Math.floor((rawLo - loop.end) / len); ; c++) {
    const segStart = loop.end + c * len;
    if (segStart >= rawHi) break;
    const from = Math.max(rawLo, segStart);
    const to = Math.min(rawHi, segStart + len);
    if (to > from) out.push({ from, to, shift: (c + 1) * len });
  }
  return out;
}

/**
 * Click track scheduled on the engine's `AudioContext` clock in transport time (the same
 * `(originCtxTime, originPos)` anchor the stems use), so clicks and stems are sample-aligned.
 * Beat positions come from a {@link BeatGrid} (fixed tempo, or a tempo map that follows the song).
 * A 25 ms timer schedules every click that falls within the next 100 ms; any transport change or
 * settings change flushes the not-yet-sounded clicks and reschedules from the new anchor. With an
 * engaged A–B loop, each lap of the window is mapped back into the loop (see {@link loopSegments}).
 */
export class Metronome {
  private settings: MetronomeSettings = { ...DEFAULT_METRONOME };
  private grid: BeatGrid = buildGrid(DEFAULT_METRONOME);
  private kit: ClickKit | null = null;
  private queue: Scheduled[] = [];
  /** Raw (unwrapped) transport position of the last scheduled tick; -Infinity after a flush. */
  private lastRaw = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingCountIn: CountInPlan | null = null;
  /** Bar index where the gap-click cycle starts (the bar playback started in). */
  private gapAnchorBar = 0;
  private unsubscribe: (() => void) | null = null;
  private readonly engine: MetronomeEngine;

  constructor(engine: MetronomeEngine) {
    this.engine = engine;
  }

  /** Start following the engine's transport. Idempotent; pair with {@link dispose} (re-connectable). */
  connect(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.engine.onTransportChange((kind, t) => this.onTransport(kind, t));
  }

  /** The grid the click currently follows. */
  getGrid(): BeatGrid {
    return this.grid;
  }

  update(patch: Partial<MetronomeSettings>): void {
    const prev = this.settings;
    const next = { ...prev, ...patch };
    this.settings = next;
    if (this.kit && next.volumeDb !== prev.volumeDb) this.kit.out.gain.value = dbToGain(next.volumeDb);
    const regrid =
      next.mode !== prev.mode ||
      next.bpm !== prev.bpm ||
      next.offsetSec !== prev.offsetSec ||
      next.beatsPerBar !== prev.beatsPerBar ||
      next.map !== prev.map ||
      next.anchors !== prev.anchors;
    if (regrid) this.grid = buildGrid(next);
    const g0 = prev.gap;
    const g1 = next.gap;
    const reschedule =
      regrid ||
      next.enabled !== prev.enabled ||
      next.subdivision !== prev.subdivision ||
      next.accents !== prev.accents ||
      g0.enabled !== g1.enabled ||
      g0.onBars !== g1.onBars ||
      g0.offBars !== g1.offBars;
    if (reschedule) {
      this.flush();
      this.lastRaw = -Infinity;
      if (this.engine.getTransport().running) {
        this.startTimer();
        this.tick();
      }
    }
  }

  /**
   * Call right before `engine.play(ids, { delaySec })`. Returns the delay to pass (0 when no
   * count-in applies: disabled, click off, or the transport is already running). The count-in runs
   * at the tempo at the start position and is phase-aligned to the grid: its last click is the
   * grid beat before the first beat the stems play, so the clicks lead straight into the song.
   */
  prepareCountIn(): number {
    this.pendingCountIn = null;
    const s = this.settings;
    const t = this.engine.getTransport();
    if (!s.enabled || s.countInBars === 0 || t.running) return 0;
    const g = this.grid;
    const start = t.pausedPos;
    let k0 = Math.ceil(g.beatIndexAt(start) - 1e-6);
    if (g.beatTime(k0) < start - 1e-6) k0++;
    const spb = g.beatTime(k0) - g.beatTime(k0 - 1);
    const n = s.countInBars * s.beatsPerBar;
    this.pendingCountIn = { n, k0, spb };
    return Math.max(0, n * spb - (g.beatTime(k0) - start));
  }

  /** Whether the click is silent at `pos` because of the gap-click cycle (for the visual cue). */
  isGapSilentAt(pos: number): boolean {
    const s = this.settings;
    if (!s.gap.enabled) return false;
    return gapSilent(this.grid.barIndex(beatIndexFloor(this.grid, pos)), this.gapAnchorBar, s.gap);
  }

  /** One scheduler pass. Public so tests (and the timer) can drive it. */
  tick(): void {
    const ctx = this.engine.context;
    const s = this.settings;
    const t = this.engine.getTransport();
    if (!ctx || !t.running || !s.enabled) return;
    const kit = this.ensureKit(ctx);

    this.queue = this.queue.filter((q) => q.when > ctx.currentTime);
    const ahead = typeof document !== 'undefined' && document.hidden ? HIDDEN_LOOKAHEAD_SEC : LOOKAHEAD_SEC;
    // Window in raw transport time, never before the anchor (clicks only sound from the origin on).
    const rawLo = Math.max(t.originPos, t.originPos + (ctx.currentTime - t.originCtxTime));
    const rawHi = t.originPos + (ctx.currentTime + ahead - t.originCtxTime);
    if (rawHi <= rawLo) return;
    for (const seg of loopSegments(rawLo, rawHi, t.loop)) this.scheduleRange(kit, t, seg.from, seg.to, seg.shift);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopTimer();
    this.flush();
    try {
      this.kit?.out.disconnect();
    } catch {
      // Context already closed.
    }
    this.kit = null;
  }

  // ── Internals ──────────────────────────────────────────────────────────────
  /** Schedule every tick with raw position in [from, to); song position = raw − shift. */
  private scheduleRange(kit: ClickKit, t: TransportSnapshot, from: number, to: number, shift: number): void {
    const s = this.settings;
    const g = this.grid;
    const S = s.subdivision;
    const posLo = from - shift;
    const posHi = to - shift;
    let count = 0;
    for (let k = beatIndexFloor(g, posLo); count < MAX_CLICKS_PER_TICK; k++) {
      const t0 = g.beatTime(k);
      if (t0 >= posHi) break;
      const t1 = S > 1 ? g.beatTime(k + 1) : t0;
      const silent = s.gap.enabled && gapSilent(g.barIndex(k), this.gapAnchorBar, s.gap);
      for (let j = 0; j < S; j++, count++) {
        const pos = t0 + (j / S) * (t1 - t0);
        if (pos >= posHi) break;
        if (pos < posLo - EPS) continue;
        const raw = pos + shift;
        if (raw <= this.lastRaw + EPS) continue;
        this.lastRaw = raw;
        const kind = silent ? null : clickKind(g.beatInBar(k), j, s.accents);
        if (kind) this.schedule(kit, t.originCtxTime + (raw - t.originPos), kind);
      }
    }
  }

  private onTransport(kind: TransportChange, t: TransportSnapshot): void {
    this.flush();
    this.lastRaw = -Infinity;
    if (kind === 'play') {
      this.gapAnchorBar = this.grid.barIndex(beatIndexFloor(this.grid, t.originPos + GAP_START_TOLERANCE));
      if (t.running && this.pendingCountIn) this.scheduleCountIn(t);
    }
    if (kind !== 'play') this.pendingCountIn = null;
    if (t.running) {
      this.startTimer();
      this.tick();
    } else {
      this.stopTimer();
    }
  }

  private scheduleCountIn(t: TransportSnapshot): void {
    const ctx = this.engine.context;
    const s = this.settings;
    const plan = this.pendingCountIn;
    this.pendingCountIn = null;
    if (!ctx || !s.enabled || !plan) return;
    const kit = this.ensureKit(ctx);
    const g = this.grid;
    // Transport time of the first stem beat, mapped through the actual anchor.
    const firstWhen = t.originCtxTime + (g.beatTime(plan.k0) - t.originPos);
    for (let j = 0; j < plan.n; j++) {
      const back = plan.n - j;
      // Count-in is always audible (ignores gap/accent-off), accenting the grid's beat 1s.
      this.schedule(kit, firstWhen - back * plan.spb, g.beatInBar(plan.k0 - back) === 0 ? 'accent' : 'normal');
    }
  }

  private schedule(kit: ClickKit, when: number, kind: ClickKind): void {
    const source = kit.ctx.createBufferSource();
    source.buffer = kit.buffers[kind];
    source.connect(kit.out);
    source.start(when);
    const entry: Scheduled = { source, when };
    source.onended = () => {
      this.queue = this.queue.filter((q) => q !== entry);
    };
    this.queue.push(entry);
  }

  /** Cancel every click that hasn't sounded yet. */
  private flush(): void {
    const ctx = this.engine.context;
    const now = ctx ? ctx.currentTime : 0;
    const keep: Scheduled[] = [];
    for (const q of this.queue) {
      if (q.when > now) {
        q.source.onended = null;
        try {
          q.source.stop();
        } catch {
          // Never started / already stopped.
        }
        try {
          q.source.disconnect();
        } catch {
          // Ignore.
        }
      } else {
        keep.push(q);
      }
    }
    this.queue = keep;
  }

  private ensureKit(ctx: AudioContext): ClickKit {
    if (this.kit && this.kit.ctx === ctx) return this.kit;
    const out = ctx.createGain();
    out.gain.value = dbToGain(this.settings.volumeDb);
    // Deliberately bypasses the master fader so the click stays audible when the mix is pulled down.
    out.connect(ctx.destination);
    this.kit = {
      ctx,
      out,
      buffers: {
        normal: renderClick(ctx, NORMAL_HZ, BASE_AMP),
        accent: renderClick(ctx, ACCENT_HZ, BASE_AMP * ACCENT_BOOST),
        sub: renderClick(ctx, SUB_HZ, BASE_AMP * SUB_CUT, SUB_CLICK_SEC),
      },
    };
    this.queue = [];
    return this.kit;
  }

  private startTimer(): void {
    if (this.timer != null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer == null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_METRONOME.bpm;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm * 10) / 10));
}

/** Bar/beat (both 1-based) at a transport position on the fixed grid. Before the first downbeat the numbers go ≤ 0. */
export function beatAt(pos: number, s: Pick<MetronomeSettings, 'bpm' | 'offsetSec' | 'beatsPerBar'>): { bar: number; beat: number } {
  return barBeatAt(new FixedGrid(s.bpm, s.offsetSec, s.beatsPerBar), pos);
}

export function barDuration(s: Pick<MetronomeSettings, 'bpm' | 'beatsPerBar'>): number {
  return (60 / s.bpm) * s.beatsPerBar;
}

/**
 * Tap tempo: averages the last (up to 8) intervals, restarts after a 2 s gap, clamps to 40–240.
 * `tap(nowMs)` returns the tempo, or null until there are two taps.
 */
export class TapTempo {
  private taps: number[] = [];

  tap(nowMs: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && nowMs - last > 2000) this.taps = [];
    this.taps.push(nowMs);
    if (this.taps.length > 9) this.taps.shift();
    if (this.taps.length < 2) return null;
    const avg = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
    return Math.min(240, Math.max(40, Math.round((60000 / avg) * 10) / 10));
  }

  reset(): void {
    this.taps = [];
  }
}
