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

/** The drums stem wins ties and near-ties: it is cleaner when it works, but must not win when it has no beat. */
const DRUMS_MARGIN = 0.05;
/** A result needs at least this many beats to count as a candidate. */
const MIN_CANDIDATE_BEATS = 8;

/** Which of two analyses to keep: drums unless the full mix is clearly more confident (or drums found nothing). */
export function chooseAnalysis(drums: BeatTrackResult | null, mix: BeatTrackResult): 'drums' | 'mix' {
  if (!drums || drums.beats.length < MIN_CANDIDATE_BEATS) return 'mix';
  if (mix.beats.length < MIN_CANDIDATE_BEATS) return 'drums';
  return drums.confidence >= mix.confidence - DRUMS_MARGIN ? 'drums' : 'mix';
}

type Progress = (fraction: number) => void;

/** Track one mono signal in a Web Worker (inline fallback where workers aren't available). */
function runTracker(
  data: Float32Array,
  rate: number,
  trackOpts: BeatWorkerRequest['opts'],
  onProgress: Progress,
  signal?: AbortSignal,
): Promise<BeatTrackResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(trackBeats(data, rate, { ...trackOpts, onProgress }));
  }
  return new Promise<BeatTrackResult>((resolve, reject) => {
    const worker = new Worker(new URL('./beatTracker.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<BeatWorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.fraction);
      else if (m.type === 'done') {
        finish();
        resolve(m.result);
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

const toSource = (b: AudioBuffer) => ({
  channels: Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)),
  sampleRate: b.sampleRate,
});

/**
 * Build a beat map from the loaded stems. When there is a drums/percussion stem, both it and the mono
 * sum of everything are tracked and the more confident one is kept (the drums stem on a tie): a drums
 * stem that is silent for the intro, or leaks nothing usable, no longer decides the result alone. The
 * downmix is chunked on the main thread; tracking runs in a Web Worker.
 */
export async function analyzeBeats(
  buffers: AudioBuffer[],
  names: string[],
  opts: { beatsPerBar: number; onProgress?: (fraction: number) => void; signal?: AbortSignal },
): Promise<BeatAnalysis> {
  if (buffers.length === 0) throw new Error('No loaded stems to analyse.');
  const idx = pickPercussiveIndex(names);
  const trackOpts = { beatsPerBar: opts.beatsPerBar };
  // With a single stem the "mix" is that stem: one pass is enough.
  const both = idx >= 0 && buffers.length > 1;
  const passes = both ? 2 : 1;
  let done = 0;
  const report = (fraction: number) => opts.onProgress?.((done + fraction) / passes);

  const analyse = async (chosen: AudioBuffer[]): Promise<BeatTrackResult> => {
    const { data, rate } = await mixToMono(chosen.map(toSource));
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await runTracker(data, rate, trackOpts, report, opts.signal);
    done += 1;
    return result;
  };

  opts.onProgress?.(0);
  const drums = idx >= 0 ? await analyse([buffers[idx]]) : null;
  const mix = both || idx < 0 ? await analyse(buffers) : null;
  if (drums && !mix) return { ...drums, source: names[idx] };
  if (!mix) throw new Error('Beat analysis produced no result.');
  if (chooseAnalysis(drums, mix) === 'drums') return { ...drums!, source: names[idx] };
  return { ...mix, source: 'all stems' };
}
