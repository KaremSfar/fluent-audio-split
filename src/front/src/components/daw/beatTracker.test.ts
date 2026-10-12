import { describe, expect, it } from 'vitest';
import { decimate, estimateDownbeat, mixToMono, trackBeats } from './beatTracker';

const SR = 22050;

/** Deterministic PRNG so noise-based tests are stable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Click train: a short 2 kHz tick at each time (+ an 80 Hz thump on accented beats) over a quiet noise floor. */
function synth(times: number[], seconds: number, accentEvery = 0, accentPhase = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const rand = rng(7);
  for (let i = 0; i < out.length; i++) out[i] = (rand() - 0.5) * 0.002;
  times.forEach((t, k) => {
    const s0 = Math.round(t * SR);
    const accent = accentEvery > 0 && k % accentEvery === accentPhase;
    const len = Math.round((accent ? 0.08 : 0.025) * SR);
    for (let i = 0; i < len && s0 + i < out.length; i++) {
      const tt = i / SR;
      let v = 0.5 * Math.sin(2 * Math.PI * 2000 * tt) * Math.exp(-tt / 0.006);
      if (accent) v += 0.8 * Math.sin(2 * Math.PI * 80 * tt) * Math.exp(-tt / 0.03);
      out[s0 + i] += v;
    }
  });
  return out;
}

/** Beat times for a tempo ramping linearly from bpm0 to bpm1 over `seconds`. */
function rampTimes(bpm0: number, bpm1: number, seconds: number, start = 0.25): number[] {
  const times: number[] = [];
  let t = start;
  while (t < seconds - 0.2) {
    times.push(t);
    const bpm = bpm0 + ((bpm1 - bpm0) * t) / seconds;
    t += 60 / bpm;
  }
  return times;
}

/** For each true beat inside the tracked span, the distance to the nearest tracked beat. */
function errors(truth: number[], beats: number[]): number[] {
  const lo = beats[0];
  const hi = beats[beats.length - 1];
  return truth
    .filter((t) => t >= lo - 0.05 && t <= hi + 0.05)
    .map((t) => Math.min(...beats.map((b) => Math.abs(b - t))));
}

describe('trackBeats', () => {
  it('tracks a steady 120 BPM click within 30 ms', () => {
    const truth = rampTimes(120, 120, 30);
    const r = trackBeats(synth(truth, 30), SR);
    expect(r.bpm).toBeGreaterThan(118);
    expect(r.bpm).toBeLessThan(122);
    expect(r.confidence).toBeGreaterThan(0.6);
    const err = errors(truth, r.beats);
    expect(err.length).toBeGreaterThan(truth.length * 0.9);
    expect(Math.max(...err)).toBeLessThan(0.02);
    // No spurious beats: one tracked beat per true beat.
    expect(r.beats.length).toBeLessThanOrEqual(truth.length + 1);
  });

  it('follows a click drifting from 110 to 120 BPM within 40 ms', () => {
    const truth = rampTimes(110, 120, 45);
    const r = trackBeats(synth(truth, 45), SR);
    expect(r.bpm).toBeGreaterThan(108);
    expect(r.bpm).toBeLessThan(122);
    const err = errors(truth, r.beats);
    expect(err.length).toBeGreaterThan(truth.length * 0.9);
    expect(Math.max(...err)).toBeLessThan(0.04);
    // The tracked tempo at the end is clearly faster than at the start.
    const head = r.beats[4] - r.beats[0];
    const tail = r.beats[r.beats.length - 1] - r.beats[r.beats.length - 5];
    expect(head / tail).toBeGreaterThan(1.05);
  });

  it('a fixed 115 BPM grid would drift off the same ramp (sanity check for the test signal)', () => {
    const truth = rampTimes(110, 120, 45);
    const spb = 60 / 115;
    const worst = Math.max(...truth.map((t) => {
      const k = Math.round((t - truth[0]) / spb);
      return Math.abs(truth[0] + k * spb - t);
    }));
    expect(worst).toBeGreaterThan(0.1);
  });

  it('reports low confidence on noise', () => {
    const rand = rng(42);
    const x = new Float32Array(SR * 30);
    for (let i = 0; i < x.length; i++) x[i] = rand() * 2 - 1;
    const r = trackBeats(x, SR);
    expect(r.confidence).toBeLessThan(0.3);
  });

  it('reports low confidence on irregular (non-periodic) hits', () => {
    const rand = rng(9);
    const times: number[] = [];
    for (let t = 0.3; t < 29; t += 0.15 + rand() * 0.8) times.push(t);
    expect(trackBeats(synth(times, 30), SR).confidence).toBeLessThan(0.4);
  });

  it('returns an empty map for silence and very short clips', () => {
    expect(trackBeats(new Float32Array(SR * 10), SR).beats).toEqual([]);
    expect(trackBeats(new Float32Array(SR), SR).confidence).toBe(0);
  });

  it('estimates the downbeat from low-band accents', () => {
    // Accent (kick) on every 4th beat starting at beat index 2.
    const truth = rampTimes(100, 100, 30);
    const r = trackBeats(synth(truth, 30, 4, 2), SR, { beatsPerBar: 4 });
    const first = r.beats[r.downbeatIndex];
    const k = truth.findIndex((t) => Math.abs(t - first) < 0.04);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k % 4).toBe(2);
  });

  it('reports monotonic progress ending at 1', () => {
    const seen: number[] = [];
    trackBeats(synth(rampTimes(120, 120, 10), 10), SR, { onProgress: (p) => seen.push(p) });
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });
});

describe('beat tracker helpers', () => {
  it('estimateDownbeat picks the strongest phase', () => {
    expect(estimateDownbeat([1, 5, 1, 1, 1, 5, 1, 1], 4)).toBe(1);
    expect(estimateDownbeat([1, 2, 3], 1)).toBe(0);
  });

  it('decimates by an integer factor', () => {
    const { data, rate } = decimate(new Float32Array(44100).fill(1), 44100);
    expect(rate).toBe(11025);
    expect(data.length).toBe(11025);
    expect(data[100]).toBeCloseTo(1, 6);
  });

  it('mixToMono averages channels and sources', async () => {
    const a = new Float32Array(8).fill(1);
    const b = new Float32Array(8).fill(0);
    const { data } = await mixToMono([{ channels: [a, b], sampleRate: 8000 }], 8000);
    expect(data[3]).toBeCloseTo(0.5, 6);
  });
});
