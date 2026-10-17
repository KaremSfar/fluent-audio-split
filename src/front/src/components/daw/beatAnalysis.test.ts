import { describe, expect, it } from 'vitest';
import { analyzeBeats, pickPercussiveIndex } from './beatAnalysis';

const SR = 22050;

/** Minimal AudioBuffer stand-in (planar mono). */
function fakeBuffer(data: Float32Array): AudioBuffer {
  return { numberOfChannels: 1, sampleRate: SR, length: data.length, getChannelData: () => data } as unknown as AudioBuffer;
}

function clicks(bpm: number, seconds: number): Float32Array {
  const out = new Float32Array(SR * seconds);
  for (let t = 0.3; t < seconds - 0.1; t += 60 / bpm) {
    const s0 = Math.round(t * SR);
    for (let i = 0; i < 400; i++) out[s0 + i] += 0.5 * Math.sin((2 * Math.PI * 2000 * i) / SR) * Math.exp(-i / 130);
  }
  return out;
}

describe('analyzeBeats', () => {
  it('prefers a drums/percussion stem by name', () => {
    expect(pickPercussiveIndex(['Vocals', 'Bass', 'Drums · drums'])).toBe(2);
    expect(pickPercussiveIndex(['Percussion'])).toBe(0);
    expect(pickPercussiveIndex(['Vocals', 'Other'])).toBe(-1);
  });

  it('analyses only the drums stem when present (inline fallback without Worker)', async () => {
    const progress: number[] = [];
    const r = await analyzeBeats(
      [fakeBuffer(new Float32Array(SR * 20)), fakeBuffer(clicks(100, 20))],
      ['Vocals', 'Drums'],
      { beatsPerBar: 4, onProgress: (p) => progress.push(p) },
    );
    expect(r.source).toBe('Drums');
    expect(r.bpm).toBeGreaterThan(98);
    expect(r.bpm).toBeLessThan(102);
    expect(progress[progress.length - 1]).toBeCloseTo(1, 6);
  });

  it('falls back to the full mix when the drums stem has no usable beat', async () => {
    const rand = (() => {
      let x = 5;
      return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 0x100000000);
    })();
    const faintDrums = new Float32Array(SR * 30).map(() => (rand() - 0.5) * 0.001);
    const r = await analyzeBeats(
      [fakeBuffer(faintDrums), fakeBuffer(clicks(110, 30))],
      ['Drums', 'Other'],
      { beatsPerBar: 4 },
    );
    expect(r.source).toBe('all stems');
    expect(r.bpm).toBeGreaterThan(108);
    expect(r.bpm).toBeLessThan(112);
  });

  it('keeps the drums stem when it is at least as confident as the mix', async () => {
    const r = await analyzeBeats([fakeBuffer(clicks(100, 25)), fakeBuffer(clicks(100, 25))], ['Drums', 'Other'], { beatsPerBar: 4 });
    expect(r.source).toBe('Drums');
  });

  it('rejects when nothing is loaded', async () => {
    await expect(analyzeBeats([], [], { beatsPerBar: 4 })).rejects.toThrow();
  });
});
