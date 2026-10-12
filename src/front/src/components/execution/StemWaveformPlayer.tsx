import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import type { StemSyncEngine } from './stemSyncEngine';

interface StemWaveformPlayerProps {
  /** Stable id for this stem within the page-level engine registry. */
  id: string;
  /** Storage path of the stem artifact (relative to the shared audio volume). */
  path: string;
  /** The page-level engine that owns all audio and drives this waveform's cursor. */
  engine: StemSyncEngine;
  /** Render a shorter waveform, suited to the compact in-canvas drawer. */
  compact?: boolean;
  /** `dark` is the Results-page studio lane style (zinc waveform, `color` as the progress fill). */
  variant?: 'default' | 'dark';
  /** Progress/cursor colour for the dark variant (any CSS colour). */
  color?: string;
  /** Dark variant only: called by the "Retry" button after a load/decode failure. */
  onRetry?: () => void;
}

/**
 * Renders the waveform for a single output stem — and nothing more. All playback (and cross-node
 * sync) lives in {@link StemSyncEngine}; this wavesurfer instance is created muted and never played.
 * It exists only to draw the waveform, report click-to-seek, and show a cursor the engine moves via
 * `setCursor`. That separation is what makes stems in different nodes sample-accurately in sync:
 * they share one audio clock in the engine instead of each being its own drifting `<audio>` element.
 *
 * Registration with the engine is done in a mount effect (not an inline ref callback) so ordinary
 * parent re-renders can't churn it — a churned registration would silently drop this stem out of
 * the shared transport.
 */
export function StemWaveformPlayer({
  id,
  path,
  engine,
  compact = false,
  variant = 'default',
  color = '#8b5cf6',
  onRetry,
}: StemWaveformPlayerProps) {
  const dark = variant === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    engine.register(id, path, {
      setCursor: (time) => wavesurferRef.current?.setTime(time),
      setError: (e) => {
        setError(e);
        if (e) setReady(false);
      },
      renderWaveform: async (blobUrl) => {
        if (wavesurferRef.current || !containerRef.current) return;
        const wavesurfer = WaveSurfer.create({
          container: containerRef.current,
          waveColor: dark ? '#71717a' : '#c4b5fd',
          progressColor: dark ? color : '#8b5cf6',
          cursorColor: dark ? '#fafafa' : '#7c3aed',
          height: dark ? 72 : compact ? 40 : 64,
          ...(dark ? { barWidth: 2, barGap: 1, barRadius: 1, normalize: true } : {}),
          url: blobUrl,
        });
        wavesurferRef.current = wavesurfer;
        // Belt and braces: the engine never calls play() on this instance, but keep it muted so a
        // stray interaction can't leak a second, unsynced audio stream.
        wavesurfer.setMuted(true);
        wavesurfer.on('error', () => setError(true));
        // Clicking/dragging any stem's waveform seeks the whole page in sync via the engine.
        wavesurfer.on('interaction', (newTime) => engine.seek(newTime));
        await new Promise<void>((resolve) => {
          wavesurfer.once('ready', () => resolve());
        });
        setError(false);
        setReady(true);
      },
    });

    return () => {
      engine.unregister(id);
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
      setReady(false);
    };
  }, [engine, id, path, compact, dark, color]);

  if (dark) {
    return (
      <div className="relative flex-1 min-w-0" style={{ minHeight: 72 }}>
        <div ref={containerRef} className="w-full" />
        {!ready && !error && (
          <div className="absolute inset-0 animate-pulse rounded bg-zinc-800/70" aria-hidden="true" />
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-red-300">
            <span>Couldn't load this stem.</span>
            {onRetry && (
              <button
                type="button"
                onClick={() => {
                  setError(false);
                  onRetry();
                }}
                className="rounded border border-red-300/60 px-2 py-0.5 text-xs hover:bg-red-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1">
      <div ref={containerRef} className="flex-1" />
      {error && <p className="text-xs text-red-600">Couldn't load this stem.</p>}
    </div>
  );
}
