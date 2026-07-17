import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import type { Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { Play, Pause } from 'lucide-react';

export interface TrimWaveformHandle {
  playSelection: () => void;
  pause: () => void;
  setRegion: (start: number, end: number) => void;
}

interface TrimWaveformProps {
  file: File;
  onSelectionChange: (start: number, end: number) => void;
  onDuration?: (seconds: number) => void;
  onDecodeError?: () => void;
}

export const TrimWaveform = forwardRef<TrimWaveformHandle, TrimWaveformProps>(
  ({ file, onSelectionChange, onDuration, onDecodeError }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const regionRef = useRef<Region | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
      if (!containerRef.current) return;

      const objectUrl = URL.createObjectURL(file);
      const regionsPlugin = RegionsPlugin.create();

      const wavesurfer = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#c4b5fd',
        progressColor: '#8b5cf6',
        cursorColor: '#7c3aed',
        height: 80,
        url: objectUrl,
      });
      wavesurfer.registerPlugin(regionsPlugin);
      wavesurferRef.current = wavesurfer;

      wavesurfer.on('ready', (duration) => {
        onDuration?.(duration);
        regionRef.current = regionsPlugin.addRegion({
          start: 0,
          end: duration,
          drag: true,
          resize: true,
          color: 'rgba(139, 92, 246, 0.2)',
        });
      });

      regionsPlugin.on('region-updated', (region) => {
        onSelectionChange(region.start, region.end);
      });

      wavesurfer.on('error', () => {
        onDecodeError?.();
      });

      wavesurfer.on('play', () => setIsPlaying(true));
      wavesurfer.on('pause', () => setIsPlaying(false));
      wavesurfer.on('finish', () => setIsPlaying(false));

      return () => {
        wavesurfer.destroy();
        URL.revokeObjectURL(objectUrl);
        wavesurferRef.current = null;
        regionRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);

    useImperativeHandle(ref, () => ({
      playSelection: () => {
        regionRef.current?.play(true);
      },
      pause: () => {
        wavesurferRef.current?.pause();
      },
      setRegion: (start: number, end: number) => {
        regionRef.current?.setOptions({ start, end });
      },
    }));

    const handlePlayPause = () => {
      if (isPlaying) {
        wavesurferRef.current?.pause();
      } else {
        regionRef.current?.play(true);
      }
    };

    return (
      <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-2">
        <div ref={containerRef} />
        <button
          type="button"
          onClick={handlePlayPause}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600"
        >
          {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {isPlaying ? 'Pause' : 'Play selection'}
        </button>
      </div>
    );
  },
);
TrimWaveform.displayName = 'TrimWaveform';
