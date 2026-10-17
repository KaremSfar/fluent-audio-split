import { describe, expect, it } from 'vitest';
import { defaultMixer, mixerReducer, type MixerState } from './useMixerState';
import { encodeMp3, encodeWav16, renderMixdown, type MixSource } from './mixdown';

const src = (...channels: number[][]): MixSource => ({
  sampleRate: 44100,
  length: channels[0].length,
  numberOfChannels: channels.length,
  getChannelData: (c) => Float32Array.from(channels[c]),
});

const sources = new Map<string, MixSource>([
  ['a', src([0.5, 0.5, 0.5, 0.5])],
  ['b', src([0.25, 0.25], [-0.25, -0.25])],
]);
const ids = ['a', 'b'];

describe('renderMixdown', () => {
  it('sums tracks, duplicates mono, pads shorter tracks', () => {
    const m = renderMixdown(sources, defaultMixer(), ids)!;
    expect([...m.left]).toEqual([0.75, 0.75, 0.5, 0.5]);
    expect([...m.right]).toEqual([0.25, 0.25, 0.5, 0.5]);
    expect(m.included).toEqual(['a', 'b']);
  });

  it('applies track volume and master volume', () => {
    let s: MixerState = defaultMixer();
    s = mixerReducer(s, { type: 'setVolume', id: 'a', db: -6.0206 });
    s = mixerReducer(s, { type: 'setMaster', db: -6.0206 });
    const m = renderMixdown(new Map([['a', sources.get('a')!]]), s, ['a'])!;
    expect(m.left[0]).toBeCloseTo(0.125, 3);
  });

  it('leaves out muted tracks', () => {
    const s = mixerReducer(defaultMixer(), { type: 'toggleMute', id: 'a' });
    expect(renderMixdown(sources, s, ids)!.included).toEqual(['b']);
  });

  it('keeps only soloed tracks when any is soloed, even if another is not muted', () => {
    const s = mixerReducer(defaultMixer(), { type: 'toggleSolo', id: 'b' });
    expect(renderMixdown(sources, s, ids)!.included).toEqual(['b']);
  });

  it('returns null when nothing is audible', () => {
    let s = mixerReducer(defaultMixer(), { type: 'toggleMute', id: 'a' });
    s = mixerReducer(s, { type: 'toggleMute', id: 'b' });
    expect(renderMixdown(sources, s, ids)).toBeNull();
    expect(renderMixdown(sources, mixerReducer(defaultMixer(), { type: 'setVolume', id: 'a', db: -Infinity }), ['a'])).toBeNull();
  });

  it('skips tracks that have not loaded', () => {
    expect(renderMixdown(sources, defaultMixer(), ['a', 'missing'])!.included).toEqual(['a']);
  });
});

describe('encodeWav16', () => {
  it('writes a valid stereo 16-bit header and clamps', async () => {
    const blob = encodeWav16({ sampleRate: 44100, left: Float32Array.from([0, 2]), right: Float32Array.from([-2, 0.5]) });
    const v = new DataView(await blob.arrayBuffer());
    expect(blob.size).toBe(44 + 8);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, -32768, 32767, 16384]);
  });
});

describe('encodeMp3', () => {
  it('produces MPEG audio frames of roughly the expected size', async () => {
    const sampleRate = 44100;
    const n = sampleRate * 2; // 2 s
    const tone = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    const blob = await encodeMp3({ sampleRate, left: tone, right: tone }, 128);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(blob.type).toBe('audio/mpeg');
    // First frame header: 11-bit sync word.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1] & 0xe0).toBe(0xe0);
    // 128 kbps for 2 s ≈ 32 KB.
    expect(bytes.length).toBeGreaterThan(28_000);
    expect(bytes.length).toBeLessThan(36_000);
  });
});
