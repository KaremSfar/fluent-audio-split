import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { filesService } from '@/services/filesService';

interface StemWaveformPlayerProps {
  /** Storage path of the stem artifact (relative to the shared audio volume). */
  path: string;
  /** Render a shorter waveform, suited to the compact in-canvas drawer. */
  compact?: boolean;
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
}

/**
 * Renders the waveform for a single output stem. Playback is entirely driven by the parent
 * `StemsPlayerGroup` via the imperative handle (this component has no play/pause button of its
 * own) so every stem in a node can start, stop and stay in sync together. Loading is still lazy:
 * nothing is fetched until the group's `load()` is called (on the first Play press).
 */
export const StemWaveformPlayer = forwardRef<StemWaveformHandle, StemWaveformPlayerProps>(
  function StemWaveformPlayer({ path, compact = false }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const loadPromiseRef = useRef<Promise<void> | null>(null);
    const [error, setError] = useState(false);

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
                // Seeking is done at the group level (or not at all) — click-to-seek on a single
                // stem would desync it from the rest of the node's playback.
                interact: false,
              });
              wavesurferRef.current = wavesurfer;
              wavesurfer.on('error', () => setError(true));

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


