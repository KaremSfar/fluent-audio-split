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

  it('rejects when nothing is loaded', async () => {
    await expect(analyzeBeats([], [], { beatsPerBar: 4 })).rejects.toThrow();
  });
});
