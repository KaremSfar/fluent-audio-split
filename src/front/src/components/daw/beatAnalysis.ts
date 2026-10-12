import { mixToMono, trackBeats, type BeatTrackResult } from './beatTracker';
import type { BeatWorkerMessage, BeatWorkerRequest } from './beatTracker.worker';

const PERCUSSIVE = /drum|perc/i;

/** Index of the buffer to analyse alone (a drums/percussion stem), or -1 to analyse the mono sum of all. */
export function pickPercussiveIndex(names: string[]): number {
  return names.findIndex((n) => PERCUSSIVE.test(n));
}

export interface BeatAnalysis extends BeatTrackResult {
  /** What was analysed, for the UI ("Drums" / "all stems"). */
  source: string;
}

/**
 * Build a beat map from the loaded stems: the drums/percussion stem when there is one, else the
 * mono sum of everything, over the whole track. The downmix is chunked on the main thread; the
 * tracking itself runs in a Web Worker (inline fallback where workers aren't available).
 */
export async function analyzeBeats(
  buffers: AudioBuffer[],
  names: string[],
  opts: { beatsPerBar: number; onProgress?: (fraction: number) => void; signal?: AbortSignal },
): Promise<BeatAnalysis> {
  if (buffers.length === 0) throw new Error('No loaded stems to analyse.');
  const idx = pickPercussiveIndex(names);
  const chosen = idx >= 0 ? [buffers[idx]] : buffers;
  const source = idx >= 0 ? names[idx] : 'all stems';
  const { data, rate } = await mixToMono(
    chosen.map((b) => ({
      channels: Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)),
      sampleRate: b.sampleRate,
    })),
  );
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  opts.onProgress?.(0.05);
  const scale = (f: number) => opts.onProgress?.(0.05 + 0.95 * f);
  const trackOpts = { beatsPerBar: opts.beatsPerBar };

  if (typeof Worker === 'undefined') {
    return { ...trackBeats(data, rate, { ...trackOpts, onProgress: scale }), source };
  }

  return new Promise<BeatAnalysis>((resolve, reject) => {
    const worker = new Worker(new URL('./beatTracker.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    opts.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<BeatWorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') scale(m.fraction);
      else if (m.type === 'done') {
        finish();
        resolve({ ...m.result, source });
      } else {
        finish();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'Beat analysis failed.'));
    };
    const req: BeatWorkerRequest = { samples: data, sampleRate: rate, opts: trackOpts };
    worker.postMessage(req, [data.buffer]);
  });
}
