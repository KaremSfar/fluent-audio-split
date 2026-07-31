import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { filesService } from '@/services/filesService';

interface StemWaveformPlayerProps {
  /** Storage path of the stem artifact (relative to the shared audio volume). */
  path: string;
  /** Render a shorter waveform, suited to the compact in-canvas drawer. */
  compact?: boolean;
  /** Fired when the user clicks/drags on this stem's waveform to seek. The parent group uses
   * this to jump every other stem to the same position, keeping the whole node in sync. */
  onSeek?: (time: number) => void;
  /** Fired when this stem reaches the end on its own (not via pause). The group uses this to
   * reset its master Play/Pause state, since nothing else marks playback as stopped. */
  onFinish?: () => void;
}

/** Imperative controls exposed to `StemsPlayerGroup`, which drives every stem's playback
 * together (DAW-style: one master transport for the whole node, not one per stem). */
export interface StemWaveformHandle {
  /** Lazily fetch the stem and create its wavesurfer instance if not already loaded. Resolves
   * once the waveform is decoded and ready to play. Safe to call more than once. */
  load: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  setMuted: (muted: boolean) => void;
  /** Jump to a specific time (seconds) without changing play/pause state — used to line this
   * stem back up after a sibling stem is seeked by the user. */
  setTime: (time: number) => void;
  isPlaying: () => boolean;
  getCurrentTime: () => number;
}

/**
 * Renders the waveform for a single output stem. Playback is entirely driven by the parent
 * `StemsPlayerGroup` via the imperative handle (this component has no play/pause button of its
 * own) so every stem in a node can start, stop and stay in sync together. Loading is still lazy:
 * nothing is fetched until the group's `load()` is called (on the first Play press).
 */
export const StemWaveformPlayer = forwardRef<StemWaveformHandle, StemWaveformPlayerProps>(
  function StemWaveformPlayer({ path, compact = false, onSeek, onFinish }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const loadPromiseRef = useRef<Promise<void> | null>(null);
    const [error, setError] = useState(false);
    // Read via a ref inside the wavesurfer event handlers below so re-registering the listener on
    // every render (and stale-closure bugs) isn't a concern.
    const onSeekRef = useRef(onSeek);
    onSeekRef.current = onSeek;
    const onFinishRef = useRef(onFinish);
    onFinishRef.current = onFinish;

    // Tear down the wavesurfer instance and revoke the blob URL on unmount / path change.
    useEffect(() => {
      return () => {
        wavesurferRef.current?.destroy();
        wavesurferRef.current = null;
        loadPromiseRef.current = null;
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
      };
    }, [path]);

    useImperativeHandle(
      ref,
      () => ({
        load: () => {
          if (wavesurferRef.current) return Promise.resolve();
          if (loadPromiseRef.current) return loadPromiseRef.current;
          if (!containerRef.current) return Promise.resolve();

          const promise = (async () => {
            setError(false);
            try {
              const objectUrl = await filesService.getObjectUrl(path);
              objectUrlRef.current = objectUrl;

              // Guard against unmount during the fetch.
              if (!containerRef.current) {
                URL.revokeObjectURL(objectUrl);
                objectUrlRef.current = null;
                return;
              }

              const wavesurfer = WaveSurfer.create({
                container: containerRef.current,
                waveColor: '#c4b5fd',
                progressColor: '#8b5cf6',
                cursorColor: '#7c3aed',
                height: compact ? 40 : 64,
                url: objectUrl,
              });
              wavesurferRef.current = wavesurfer;
              wavesurfer.on('error', () => setError(true));
              // Clicking/dragging on any one stem's waveform seeks the whole group — the group
              // is what re-broadcasts this to every other stem via their `setTime` handle.
              wavesurfer.on('interaction', (newTime) => onSeekRef.current?.(newTime));
              wavesurfer.on('finish', () => onFinishRef.current?.());

              await new Promise<void>((resolve) => {
                wavesurfer.once('ready', () => resolve());
              });
            } catch {
              setError(true);
            }
          })();
          loadPromiseRef.current = promise;
          return promise;
        },
        play: async () => {
          await wavesurferRef.current?.play();
        },
        pause: () => {
          wavesurferRef.current?.pause();
        },
        setMuted: (muted: boolean) => {
          wavesurferRef.current?.setMuted(muted);
        },
        setTime: (time: number) => {
          wavesurferRef.current?.setTime(time);
        },
        isPlaying: () => wavesurferRef.current?.isPlaying() ?? false,
        getCurrentTime: () => wavesurferRef.current?.getCurrentTime() ?? 0,
      }),
      [path, compact],
    );

    return (
      <div className="flex-1">
        <div ref={containerRef} className="flex-1" />
        {error && <p className="text-xs text-red-600">Couldn't load this stem.</p>}
      </div>
    );
  },
);


