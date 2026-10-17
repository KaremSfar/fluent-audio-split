import { dbToGain } from './gain';
import { isAudible, trackMix, type MixerState } from './useMixerState';

/** The slice of an AudioBuffer the mixdown needs (keeps this testable without Web Audio). */
export interface MixSource {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface Mixdown {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  /** Track ids that made it into the mix. */
  included: string[];
}

/**
 * Sum the audible tracks into a stereo mix exactly as the mixer plays them: per-track fader, mute/solo,
 * then master. Mono tracks feed both channels; shorter tracks are padded with silence.
 * Returns null when nothing is audible (so the caller can say so instead of exporting silence).
 */
export function renderMixdown(
  sources: ReadonlyMap<string, MixSource>,
  mixer: MixerState,
  trackIds: readonly string[],
): Mixdown | null {
  const active = trackIds.filter((id) => sources.has(id) && isAudible(mixer, id) && dbToGain(trackMix(mixer, id).volumeDb) > 0);
  if (active.length === 0) return null;

  const sampleRate = sources.get(active[0])!.sampleRate;
  const length = Math.max(...active.map((id) => sources.get(id)!.length));
  const master = dbToGain(mixer.masterDb);
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  for (const id of active) {
    const src = sources.get(id)!;
    if (src.sampleRate !== sampleRate) throw new Error('Tracks have different sample rates');
    const gain = dbToGain(trackMix(mixer, id).volumeDb) * master;
    const l = src.getChannelData(0);
    const r = src.numberOfChannels > 1 ? src.getChannelData(1) : l;
    for (let i = 0; i < src.length; i++) {
      left[i] += l[i] * gain;
      right[i] += r[i] * gain;
    }
  }
  return { sampleRate, left, right, included: active };
}

const pcm = (x: number) => (x <= -1 ? -32768 : x >= 1 ? 32767 : Math.round(x * 32767));

/** Encode a stereo mix as 16-bit PCM WAV (hard-clamped; every player reads it). */
export function encodeWav16(mix: Pick<Mixdown, 'sampleRate' | 'left' | 'right'>): Blob {
  const { sampleRate, left, right } = mix;
  const frames = left.length;
  const dataBytes = frames * 4;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true); // block align
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);

  let o = 44;
  for (let i = 0; i < frames; i++) {
    view.setInt16(o, pcm(left[i]), true);
    view.setInt16(o + 2, pcm(right[i]), true);
    o += 4;
  }
  return new Blob([view], { type: 'audio/wav' });
}

export const MP3_KBPS = 192;
const MP3_BLOCK = 1152; // one MPEG-1 Layer III frame
const BLOCKS_PER_SLICE = 400; // ~10 s of audio per slice, then yield so the page stays responsive

/** Encode a stereo mix as a 192 kbps MP3. The encoder is loaded on demand (it is only needed on export). */
export async function encodeMp3(mix: Pick<Mixdown, 'sampleRate' | 'left' | 'right'>, kbps = MP3_KBPS): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const { sampleRate, left, right } = mix;
  const encoder = new Mp3Encoder(2, sampleRate, kbps);
  const parts: Uint8Array[] = [];
  const l = new Int16Array(MP3_BLOCK);
  const r = new Int16Array(MP3_BLOCK);

  for (let start = 0, block = 0; start < left.length; start += MP3_BLOCK, block++) {
    const n = Math.min(MP3_BLOCK, left.length - start);
    // The last block is zero-padded: the Int16Arrays are reused, so stale samples must not leak in.
    l.fill(0);
    r.fill(0);
    for (let i = 0; i < n; i++) {
      l[i] = pcm(left[start + i]);
      r[i] = pcm(right[start + i]);
    }
    const chunk = encoder.encodeBuffer(l, r);
    if (chunk.length > 0) parts.push(chunk);
    if (block % BLOCKS_PER_SLICE === BLOCKS_PER_SLICE - 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail);
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}
