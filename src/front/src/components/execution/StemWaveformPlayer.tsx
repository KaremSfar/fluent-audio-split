import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Loader2 } from 'lucide-react';
import { filesService } from '@/services/filesService';

interface StemWaveformPlayerProps {
  /** Storage path of the stem artifact (relative to the shared audio volume). */
  path: string;
  /** Render a shorter waveform, suited to the compact in-canvas drawer. */
  compact?: boolean;
}

/**
 * Inline waveform player for a single output stem. The audio is auth-gated and the
 * download endpoint has no Range support, so we fetch the whole file as a blob and
 * feed an object URL to wavesurfer. Loading is lazy: nothing is fetched until the
 * user presses Play the first time.
 */
export function StemWaveformPlayer({ path, compact = false }: StemWaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  // Tear down the wavesurfer instance and revoke the blob URL on unmount / path change.
  useEffect(() => {
    return () => {
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [path]);

  const handlePlayPause = async () => {
    // Already initialized: just toggle.
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
      return;
    }
    if (isLoading || !containerRef.current) return;

    setIsLoading(true);
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

      wavesurfer.on('ready', () => {
        setIsLoading(false);
        wavesurfer.play();
      });
      wavesurfer.on('play', () => setIsPlaying(true));
      wavesurfer.on('pause', () => setIsPlaying(false));
      wavesurfer.on('finish', () => setIsPlaying(false));
      wavesurfer.on('error', () => {
        setError(true);
        setIsLoading(false);
      });
    } catch {
      setError(true);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={isLoading}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-60"
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
        </button>
        <div ref={containerRef} className="flex-1" />
      </div>
      {error && <p className="text-xs text-red-600">Couldn't load this stem.</p>}
    </div>
  );
}
