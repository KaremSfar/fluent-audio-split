import { trackBeats, type BeatTrackOptions, type BeatTrackResult } from './beatTracker';

export interface BeatWorkerRequest {
  samples: Float32Array;
  sampleRate: number;
  opts: Omit<BeatTrackOptions, 'onProgress'>;
}

export type BeatWorkerMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; result: BeatTrackResult }
  | { type: 'error'; message: string };

// Typed minimally: the app's tsconfig uses the DOM lib, which conflicts with the webworker lib.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BeatWorkerRequest>) => void) | null;
  postMessage: (m: BeatWorkerMessage) => void;
};

scope.onmessage = (e: MessageEvent<BeatWorkerRequest>) => {
  const { samples, sampleRate, opts } = e.data;
  const post = (m: BeatWorkerMessage) => scope.postMessage(m);
  try {
    const result = trackBeats(samples, sampleRate, { ...opts, onProgress: (fraction) => post({ type: 'progress', fraction }) });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
