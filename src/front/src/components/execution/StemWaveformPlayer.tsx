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
export function StemWaveformPlayer({ id, path, engine, compact = false }: StemWaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    engine.register(id, path, {
      setCursor: (time) => wavesurferRef.current?.setTime(time),
      setError: (e) => setError(e),
      renderWaveform: async (blobUrl) => {
        if (wavesurferRef.current || !containerRef.current) return;
        const wavesurfer = WaveSurfer.create({
          container: containerRef.current,
          waveColor: '#c4b5fd',
          progressColor: '#8b5cf6',
          cursorColor: '#7c3aed',
          height: compact ? 40 : 64,
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
      },
    });

    return () => {
      engine.unregister(id);
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
    };
  }, [engine, id, path, compact]);

  return (
    <div className="flex-1">
      <div ref={containerRef} className="flex-1" />
      {error && <p className="text-xs text-red-600">Couldn't load this stem.</p>}
    </div>
  );
}
