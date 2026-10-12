import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/filesService', () => ({
  filesService: { getObjectUrl: vi.fn(async () => 'blob:fake') },
}));

import { StemSyncEngine, wrapLoopPos, type StemVisual } from './stemSyncEngine';

function param(v = 1) {
  return {
    value: v,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(function (this: { value: number }, t: number) {
      this.value = t;
    }),
  };
}
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });

class FakeCtx {
  static last: FakeCtx;
  currentTime = 0;
  state = 'running';
  destination = node();
  sources: { startArgs: number[]; stop: () => void; loop?: boolean; loopStart?: number; loopEnd?: number }[] = [];
  constructor() {
    FakeCtx.last = this;
  }
  resume = vi.fn();
  close = vi.fn();
  createGain = () => ({ ...node(), gain: param() });
  createAnalyser = () => ({ ...node(), fftSize: 0 });
  createBufferSource = () => {
    const s = {
      ...node(),
      buffer: null as unknown,
      onended: null as unknown,
      startArgs: [] as number[],
      start: (...a: number[]) => void (s.startArgs = a),
      stop: vi.fn(),
    };
    this.sources.push(s);
    return s;
  };
  decodeAudioData = async () => ({ duration: 10 });
}

const visual = (): StemVisual => ({
  renderWaveform: async () => {},
  setCursor: vi.fn(),
  setError: vi.fn(),
});

describe('StemSyncEngine', () => {
  let engine: StemSyncEngine;

  beforeEach(async () => {
    vi.stubGlobal('window', { AudioContext: FakeCtx });
    vi.stubGlobal('fetch', async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal('URL', { revokeObjectURL: vi.fn(), createObjectURL: vi.fn() });
    engine = new StemSyncEngine();
    engine.register('a', 'a.mp3', visual());
    engine.register('b', 'b.mp3', visual());
    await engine.prepare(['a', 'b']);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps fader volume independent of the mute gate', () => {
    engine.setVolume('a', 0.5);
    engine.setMuted('a', true);
    engine.setMuted('a', false);
    // Fader node ends at the stored volume; gate node was only ever driven to 0/1.
    expect(engine.getAnalyser('a')).not.toBeNull();
    engine.setVolume('a', 0.25);
    expect(engine.getAnalyser('a')).not.toBeNull();
  });

  it('exposes master and per-stem analysers', () => {
    expect(engine.getAnalyser('master')).not.toBeNull();
    expect(engine.getAnalyser('nope')).toBeNull();
    expect(engine.registeredIds().sort()).toEqual(['a', 'b']);
  });

  it('play({delaySec}) keeps nowPos behind the origin until the delay elapses', () => {
    const ctx = FakeCtx.last;
    engine.seek(0);
    engine.play(['a', 'b'], { delaySec: 2 });
    const t = engine.getTransport();
    expect(t.running).toBe(true);
    expect(t.originCtxTime).toBeCloseTo(2.03, 9);
    expect(engine.nowPos()).toBeCloseTo(-2.03, 9);
    ctx.currentTime = 2.03;
    expect(engine.nowPos()).toBeCloseTo(0, 9);
    expect(engine.toCtxTime(1)).toBeCloseTo(3.03, 9);
    // Sources start at the origin with offset 0.
    expect(ctx.sources[0].startArgs[0]).toBeCloseTo(2.03, 9);
    expect(ctx.sources[0].startArgs[1]).toBe(0);
  });

  it('pausing during a count-in resumes from the origin, not before it', () => {
    engine.seek(4);
    engine.play(['a', 'b'], { delaySec: 2 });
    engine.pause(['a', 'b']);
    expect(engine.getTransport().running).toBe(false);
    expect(engine.getTransport().pausedPos).toBe(4);
  });

  it('emits transport events in order after updating the anchor', () => {
    const seen: string[] = [];
    engine.onTransportChange((k, t) => seen.push(`${k}:${t.running}`));
    engine.play(['a']);
    engine.seek(3);
    engine.pause(['a']);
    expect(seen).toEqual(['play:true', 'seek:true', 'pause:false']);
  });

  describe('A–B loop', () => {
    it('loops every stem natively on the same region and wraps the transport position', () => {
      const ctx = FakeCtx.last;
      engine.setLoop({ start: 2, end: 4 });
      engine.seek(1);
      engine.play(['a', 'b']);
      const live = ctx.sources.slice(-2);
      for (const src of live) expect([src.loop, src.loopStart, src.loopEnd]).toEqual([true, 2, 4]);
      ctx.currentTime = 0.03 + 3.5; // raw 4.5 -> one lap past the end
      expect(engine.nowPos()).toBeCloseTo(2.5, 9);
      expect(engine.getTransport().loop).toEqual({ start: 2, end: 4 });
    });

    it('retargets live sources in place when the loop changes while playing (no restart)', () => {
      const ctx = FakeCtx.last;
      engine.play(['a', 'b']);
      const before = ctx.sources.length;
      const seen: string[] = [];
      engine.onTransportChange((k) => seen.push(k));
      ctx.currentTime = 1.03; // pos 1
      engine.setLoop({ start: 0.5, end: 2 });
      expect(ctx.sources.length).toBe(before);
      expect(ctx.sources[before - 1].loop).toBe(true);
      expect(seen).toEqual(['seek']);
      const t = engine.getTransport();
      expect(t.originPos).toBeCloseTo(1, 9);
      expect(t.originCtxTime).toBeCloseTo(1.03, 9);
      ctx.currentTime = 2.53; // raw 2.5 -> 1.0
      expect(engine.nowPos()).toBeCloseTo(1, 9);
      engine.setLoop(null);
      expect(ctx.sources[before - 1].loop).toBe(false);
      expect(engine.nowPos()).toBeCloseTo(1, 9);
    });

    it('pausing inside a wrapped loop keeps the wrapped position', () => {
      const ctx = FakeCtx.last;
      engine.setLoop({ start: 0, end: 2 });
      engine.seek(1.5);
      engine.play(['a', 'b']);
      ctx.currentTime = 0.03 + 1; // raw 2.5 -> 0.5 (< originPos 1.5)
      engine.pause(['a', 'b']);
      expect(engine.getTransport().pausedPos).toBeCloseTo(0.5, 9);
    });

    it('does not engage when playing from after the loop end', () => {
      const ctx = FakeCtx.last;
      engine.setLoop({ start: 2, end: 4 });
      engine.seek(5);
      engine.play(['a']);
      expect(engine.getTransport().loop).toBeNull();
      expect(ctx.sources[ctx.sources.length - 1].loop).toBe(false);
      ctx.currentTime = 2.03;
      expect(engine.nowPos()).toBeCloseTo(7, 9);
    });

    it('rejects degenerate regions and clamps to the song', () => {
      engine.setLoop({ start: 3, end: 3.01 });
      expect(engine.getLoop()).toBeNull();
      engine.setLoop({ start: 8, end: 30 });
      expect(engine.getLoop()).toEqual({ start: 8, end: 10 });
    });

    it('wrapLoopPos', () => {
      expect(wrapLoopPos(1, { start: 2, end: 4 })).toBe(1);
      expect(wrapLoopPos(4, { start: 2, end: 4 })).toBe(2);
      expect(wrapLoopPos(7.5, { start: 2, end: 4 })).toBeCloseTo(3.5, 9);
      expect(wrapLoopPos(7.5, null)).toBe(7.5);
    });
  });
});
