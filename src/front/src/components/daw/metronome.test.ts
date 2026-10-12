import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopRegion, TransportChange, TransportSnapshot } from '@/components/execution/stemSyncEngine';
import {
  Metronome,
  TapTempo,
  beatAt,
  clampBpm,
  clickKind,
  gapSilent,
  loopSegments,
  resizeAccents,
  type ClickKind,
  type MetronomeEngine,
} from './metronome';
import type { TempoMap } from './beatGrid';

class FakeSource {
  buffer: { kind?: ClickKind } | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connect() {}
  disconnect() {}
  start(when: number) {
    this.startedAt = when;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeCtx {
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  sources: FakeSource[] = [];
  private made = 0;
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createBuffer(_c: number, n: number) {
    const data = new Float32Array(n);
    // The kit renders its buffers in this order.
    const kind = (['normal', 'accent', 'sub'] as const)[this.made++ % 3];
    return { kind, getChannelData: () => data };
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
}

/** Minimal engine: same anchor math as StemSyncEngine. */
class FakeEngine {
  ctx = new FakeCtx();
  t: TransportSnapshot = { running: false, originCtxTime: 0, originPos: 0, pausedPos: 0, duration: 100 };
  listeners = new Set<(k: TransportChange, t: TransportSnapshot) => void>();
  get context() {
    return this.ctx as unknown as AudioContext;
  }
  getTransport = () => this.t;
  onTransportChange = (cb: (k: TransportChange, t: TransportSnapshot) => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  private emit(k: TransportChange) {
    for (const l of this.listeners) l(k, this.t);
  }
  play(pos: number, delay = 0) {
    this.t = { ...this.t, running: true, originPos: pos, originCtxTime: this.ctx.currentTime + 0.03 + delay };
    this.emit('play');
  }
  seek(pos: number) {
    this.t = { ...this.t, originPos: pos, originCtxTime: this.ctx.currentTime + 0.03 };
    this.emit('seek');
  }
  /** Loop engaged from the current anchor (same semantics as StemSyncEngine.setLoop). */
  setLoop(loop: LoopRegion | null) {
    this.t = { ...this.t, loop };
    this.emit('seek');
  }
  pause() {
    this.t = { ...this.t, running: false };
    this.emit('pause');
  }
  advance(sec: number, m: Metronome) {
    const step = 0.025;
    for (let e = 0; e < sec - 1e-9; e += step) {
      this.ctx.currentTime += step;
      m.tick();
    }
  }
}

const active = (e: FakeEngine) =>
  e.ctx.sources.filter((s) => !s.stopped && s.startedAt != null).map((s) => s.startedAt as number);
const clicks = (e: FakeEngine) =>
  e.ctx.sources
    .filter((s) => !s.stopped && s.startedAt != null)
    .map((s) => ({ t: s.startedAt as number, kind: s.buffer?.kind }))
    .sort((a, b) => a.t - b.t);
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

/** Beat times for a tempo ramping linearly from bpm0 to bpm1 over `seconds`. */
function ramp(bpm0: number, bpm1: number, seconds: number, start = 0): number[] {
  const out: number[] = [];
  for (let t = start; t < seconds; t += 60 / (bpm0 + ((bpm1 - bpm0) * t) / seconds)) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}
const mapOf = (beats: number[], downbeatIndex = 0): TempoMap => ({ beats, downbeatIndex, bpm: 0, confidence: 1 });

describe('Metronome', () => {
  let engine: FakeEngine;
  let m: Metronome;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new FakeEngine();
    m = new Metronome(engine as unknown as MetronomeEngine);
    m.connect();
    m.update({ enabled: true, bpm: 120, beatsPerBar: 4, offsetSec: 0 });
  });
  afterEach(() => {
    m.dispose();
    vi.useRealTimers();
  });

  it('schedules clicks exactly on the transport grid', () => {
    engine.play(0);
    engine.advance(2, m);
    const times = active(engine).sort((a, b) => a - b);
    expect(times.length).toBeGreaterThanOrEqual(4);
    times.forEach((t, k) => expect(Math.abs(t - (0.03 + k * 0.5))).toBeLessThan(1e-9));
  });

  it('never double-schedules a beat', () => {
    engine.play(0);
    engine.advance(3, m);
    const times = active(engine);
    expect(new Set(times.map((t) => t.toFixed(6))).size).toBe(times.length);
  });

  it('flushes future clicks on seek and realigns to the new anchor', () => {
    engine.play(0);
    engine.advance(1, m);
    engine.seek(10.2); // mid-beat: next beat at 10.5
    const origin = engine.t.originCtxTime;
    engine.advance(1, m);
    const after = active(engine).filter((t) => t >= origin - 1e-9);
    expect(after.length).toBeGreaterThan(0);
    // beat at pos 10.5 -> ctx origin + 0.3; pos 11.0 -> origin + 0.8
    expect(Math.abs(after.sort((a, b) => a - b)[0] - (origin + 0.3))).toBeLessThan(1e-9);
    // Nothing from the old timeline remains scheduled in the future of the seek.
    const stale = engine.ctx.sources.filter((s) => s.stopped);
    expect(stale.length).toBeGreaterThanOrEqual(0);
  });

  it('honours the grid offset', () => {
    m.update({ offsetSec: 0.25 });
    engine.play(0);
    engine.advance(1, m);
    const times = active(engine).sort((a, b) => a - b);
    expect(Math.abs(times[0] - (0.03 + 0.25))).toBeLessThan(1e-9);
    expect(Math.abs(times[1] - (0.03 + 0.75))).toBeLessThan(1e-9);
  });

  it('stops scheduling on pause and cancels unsounded clicks', () => {
    engine.play(0);
    engine.advance(0.5, m);
    engine.pause();
    const n = engine.ctx.sources.length;
    engine.advance(2, m);
    expect(engine.ctx.sources.length).toBe(n);
  });

  it('plays a count-in of N clicks before the origin', () => {
    m.update({ countInBars: 1, beatsPerBar: 4 });
    const delay = m.prepareCountIn();
    expect(delay).toBeCloseTo(2, 9);
    engine.play(0, delay);
    const origin = engine.t.originCtxTime;
    const pre = active(engine).filter((t) => t < origin - 1e-9).sort((a, b) => a - b);
    expect(pre).toHaveLength(4);
    pre.forEach((t, j) => expect(Math.abs(t - (origin - (4 - j) * 0.5))).toBeLessThan(1e-9));
  });

  it('skips the count-in when the transport is already running', () => {
    m.update({ countInBars: 2 });
    engine.play(0);
    expect(m.prepareCountIn()).toBe(0);
  });

  it('applies a bpm change from the next unsounded beat', () => {
    engine.play(0);
    engine.advance(1, m);
    m.update({ bpm: 60 });
    engine.advance(3, m);
    const now = engine.ctx.currentTime;
    const future = active(engine).filter((t) => t > now - 3 && t > 1.1).sort((a, b) => a - b);
    for (const t of future) {
      const k = (t - 0.03) / 1;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
  });
});

describe('Metronome with a beat map', () => {
  let engine: FakeEngine;
  let m: Metronome;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new FakeEngine();
    m = new Metronome(engine as unknown as MetronomeEngine);
    m.connect();
    m.update({ enabled: true, bpm: 120, beatsPerBar: 4, offsetSec: 0 });
  });
  afterEach(() => {
    m.dispose();
    vi.useRealTimers();
  });

  it('follows a drifting map beat-for-beat (where a fixed grid would drift off)', () => {
    const beats = ramp(100, 130, 20, 0.2);
    m.update({ mode: 'follow', map: mapOf(beats) });
    engine.play(0);
    engine.advance(20, m);
    const got = active(engine).sort((a, b) => a - b);
    const expected = beats.map((b) => 0.03 + b);
    expect(got.length).toBeGreaterThanOrEqual(expected.length - 1);
    got.slice(0, expected.length).forEach((t, i) => expect(near(t, expected[i])).toBe(true));
    // Sanity: the best fixed grid is far off somewhere on this ramp.
    const spb = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
    expect(Math.max(...beats.map((b, i) => Math.abs(beats[0] + i * spb - b)))).toBeGreaterThan(0.1);
  });

  it('extrapolates past the end of the map with the local tempo', () => {
    const beats = [0, 0.5, 1, 1.5, 2, 2.4, 2.8, 3.2, 3.6, 4.0, 4.4, 4.8, 5.2];
    m.update({ mode: 'follow', map: mapOf(beats) });
    engine.play(0);
    engine.advance(6.5, m);
    const got = active(engine).sort((a, b) => a - b).map((t) => t - 0.03);
    expect(got.some((t) => near(t, 5.6, 1e-6))).toBe(true);
    expect(got.some((t) => near(t, 6.0, 1e-6))).toBe(true);
  });

  it('realigns to the map after a seek', () => {
    const beats = ramp(110, 120, 30, 0.1);
    m.update({ mode: 'follow', map: mapOf(beats) });
    engine.play(0);
    engine.advance(1, m);
    engine.seek(10.2);
    const origin = engine.t.originCtxTime;
    engine.advance(1, m);
    const next = beats.find((b) => b >= 10.2)!;
    const after = active(engine).filter((t) => t >= origin - 1e-9).sort((a, b) => a - b);
    expect(near(after[0], origin + (next - 10.2))).toBe(true);
  });

  it('applies anchors to the scheduled clicks', () => {
    const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
    m.update({ mode: 'follow', map: mapOf(beats), anchors: [{ pos: 2.04, kind: 'beat' }] });
    engine.play(0);
    engine.advance(4, m);
    const got = active(engine).map((t) => t - 0.03);
    expect(got.some((t) => near(t, 2.04, 1e-6))).toBe(true);
    expect(got.some((t) => near(t, 3.54, 1e-6))).toBe(true);
    expect(got.some((t) => near(t, 0, 1e-6))).toBe(true);
  });

  it('plays subdivisions as softer sub clicks between beats', () => {
    m.update({ subdivision: 3 });
    engine.play(0);
    engine.advance(1.05, m);
    const c = clicks(engine).filter((x) => x.t < 0.03 + 1 - 1e-6);
    expect(c.map((x) => x.kind)).toEqual(['accent', 'sub', 'sub', 'normal', 'sub', 'sub']);
    c.forEach((x, i) => expect(near(x.t, 0.03 + i / 6)).toBe(true));
  });

  it('honours the per-beat accent pattern (odd meter)', () => {
    m.update({ beatsPerBar: 5, accents: [2, 1, 0, 2, 1] });
    engine.play(0);
    engine.advance(2.6, m);
    const c = clicks(engine).filter((x) => x.t < 0.03 + 2.5 - 1e-6);
    // Beat 3 is off: 4 clicks per 5-beat bar.
    expect(c.map((x) => x.kind)).toEqual(['accent', 'normal', 'accent', 'normal']);
    expect(c.map((x) => Math.round((x.t - 0.03) * 10) / 10)).toEqual([0, 0.5, 1.5, 2]);
  });

  it('gap click: N bars on, M bars silent, counted from the bar playback started in', () => {
    m.update({ gap: { enabled: true, onBars: 1, offBars: 1, visualCue: true } });
    engine.play(0);
    engine.advance(8.1, m);
    const bars = new Set(active(engine).map((t) => Math.floor((t - 0.03 + 1e-6) / 2)));
    expect([...bars].sort()).toEqual([0, 2, 4]);
    expect(m.isGapSilentAt(3)).toBe(true);
    expect(m.isGapSilentAt(4.5)).toBe(false);

    engine.pause();
    engine.t = { ...engine.t, pausedPos: 6 };
    engine.play(6);
    const origin = engine.t.originCtxTime;
    engine.advance(4.1, m);
    const later = new Set(
      active(engine).filter((t) => t >= origin - 1e-9).map((t) => 3 + Math.floor((t - origin + 1e-6) / 2)),
    );
    expect([...later].sort()).toEqual([3, 5]);
  });

  it('count-in runs at the tempo at the start and is phase-aligned to the map', () => {
    // Beat period 0.4 s around 10 s, starting mid-beat (next beat at 10.2).
    const beats = Array.from({ length: 60 }, (_, i) => 0.2 + i * 0.4);
    m.update({ mode: 'follow', map: mapOf(beats), countInBars: 1 });
    engine.t = { ...engine.t, pausedPos: 10.05 };
    const delay = m.prepareCountIn();
    expect(delay).toBeCloseTo(4 * 0.4 - 0.15, 9);
    engine.play(10.05, delay);
    const origin = engine.t.originCtxTime;
    const firstStemBeat = origin + 0.15;
    const pre = active(engine).filter((t) => t < origin).sort((a, b) => a - b);
    expect(pre).toHaveLength(4);
    pre.forEach((t, j) => expect(near(t, firstStemBeat - (4 - j) * 0.4)).toBe(true));
    // ...and the regular click picks up exactly one beat after the last count-in click.
    engine.advance(delay + 0.5, m);
    expect(active(engine).some((t) => near(t, firstStemBeat))).toBe(true);
  });

  it('keeps clicking seamlessly across loop laps', () => {
    // 1-bar loop at 120 BPM: clicks continue every 0.5 s, accent every 2 s.
    engine.play(0);
    engine.setLoop({ start: 0, end: 2 });
    const origin = engine.t.originCtxTime;
    engine.advance(6, m);
    const c = clicks(engine).filter((x) => x.t >= origin - 1e-9 && x.t < origin + 5.9);
    c.forEach((x, i) => {
      expect(near(x.t, origin + i * 0.5)).toBe(true);
      expect(x.kind).toBe(i % 4 === 0 ? 'accent' : 'normal');
    });
    expect(c.length).toBe(12);
  });

  it('maps loop laps back into the loop for a loop that is not a whole number of beats', () => {
    engine.play(0);
    engine.setLoop({ start: 0, end: 1.25 });
    const origin = engine.t.originCtxTime;
    engine.advance(3, m);
    const rel = clicks(engine)
      .filter((x) => x.t >= origin - 1e-9 && x.t < origin + 2.6)
      .map((x) => Math.round((x.t - origin) * 1000) / 1000);
    expect(rel).toEqual([0, 0.5, 1, 1.25, 1.75, 2.25, 2.5]);
  });
});

describe('metronome helpers', () => {
  it('loopSegments splits a window into laps', () => {
    expect(loopSegments(0, 1, null)).toEqual([{ from: 0, to: 1, shift: 0 }]);
    expect(loopSegments(1.9, 2.3, { start: 0, end: 2 })).toEqual([
      { from: 1.9, to: 2, shift: 0 },
      { from: 2, to: 2.3, shift: 2 },
    ]);
    expect(loopSegments(5.9, 6.1, { start: 1, end: 3 })).toEqual([
      { from: 5.9, to: 6.1, shift: 4 },
    ]);
  });

  it('gapSilent cycles on/off bars from the anchor bar', () => {
    const g = { enabled: true, onBars: 2, offBars: 1, visualCue: false };
    expect([5, 6, 7, 8, 9, 10].map((b) => gapSilent(b, 5, g))).toEqual([false, false, true, false, false, true]);
    expect(gapSilent(4, 5, g)).toBe(true);
    expect(gapSilent(7, 5, { ...g, enabled: false })).toBe(false);
  });

  it('clickKind maps accents and subdivisions', () => {
    expect(clickKind(0, 0, [2, 1, 0])).toBe('accent');
    expect(clickKind(1, 0, [2, 1, 0])).toBe('normal');
    expect(clickKind(2, 0, [2, 1, 0])).toBeNull();
    expect(clickKind(2, 1, [2, 1, 0])).toBe('sub');
    expect(clickKind(5, 0, [2])).toBe('normal');
  });

  it('resizeAccents keeps the prefix', () => {
    expect(resizeAccents([2, 0, 1, 1], 6)).toEqual([2, 0, 1, 1, 1, 1]);
    expect(resizeAccents([2, 0, 1, 1], 2)).toEqual([2, 0]);
  });

  it('computes bar and beat', () => {
    const s = { bpm: 120, offsetSec: 0, beatsPerBar: 4 };
    expect(beatAt(0, s)).toEqual({ bar: 1, beat: 1 });
    expect(beatAt(2.0, s)).toEqual({ bar: 2, beat: 1 });
    expect(beatAt(2.6, s)).toEqual({ bar: 2, beat: 2 });
  });

  it('clamps bpm', () => {
    expect(clampBpm(500)).toBe(300);
    expect(clampBpm(5)).toBe(20);
    expect(clampBpm(123.456)).toBe(123.5);
  });

  it('tap tempo averages intervals and restarts after a gap', () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(500)).toBe(120);
    expect(t.tap(1000)).toBe(120);
    expect(t.tap(10_000)).toBeNull();
  });
});
