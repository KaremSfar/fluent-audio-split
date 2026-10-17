import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StemSyncEngine } from '@/components/execution/stemSyncEngine';
import type { BeatGrid } from './beatGrid';
import type { MetronomeSettings } from './metronome';
import { VolumeFader } from './VolumeFader';
import { gridPaths } from './gridPaths';
import { useTransportPos } from './useTransportPos';
import { dawFocus } from './ui';

/** Same 32 px visual button / 44 px hit area as the stem tracks. */
const HIT = "relative before:absolute before:-inset-1.5 before:content-['']";
const ms = cn(HIT, 'size-8 shrink-0 rounded-md text-xs font-bold transition-colors', dawFocus);
const msOff = 'bg-daw-control text-muted-foreground hover:bg-daw-control-hover hover:text-foreground';

const CLICK_COLOR = '#f59e0b';
const LANE_H = 48;
const TICKS = { bar: '6V42', beat: '18V42' };

interface ClickLaneProps {
  engine: StemSyncEngine;
  duration: number;
  grid: BeatGrid;
  settings: MetronomeSettings;
  onChange: (patch: Partial<MetronomeSettings>) => void;
  /** The page draws one shared playhead over the lanes (wide layouts); otherwise this lane shows its own. */
  sharedPlayhead: boolean;
  /** The metronome controls, shown under the lane when expanded. */
  children: ReactNode;
}

/** The click as its own lane: channel header (on/off, volume) + bar/beat ticks, with the full controls expandable below. */
export function ClickLane({ engine, duration, grid, settings: s, onChange, sharedPlayhead, children }: ClickLaneProps) {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const pos = useTransportPos(engine);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paths = useMemo(() => gridPaths(grid, duration, width, TICKS), [grid, duration, width]);
  const follow = s.mode === 'follow' && !!s.map;
  const summary = !s.enabled ? 'Off' : follow ? `Follows song · ≈${s.map!.bpm.toFixed(1)} BPM` : `Fixed · ${s.bpm} BPM · ${s.beatsPerBar} beats/bar`;
  const panelId = 'click-settings';

  const seek = (clientX: number) => {
    const el = bodyRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    engine.seek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration);
  };

  return (
    <div role="group" aria-labelledby="track-name-click" className="border-b border-daw-border">
      <div className={cn('grid grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]', !s.enabled && 'opacity-60')}>
        <div className="relative flex min-w-0 flex-col gap-1.5 bg-daw-surface py-2.5 pl-4 pr-3">
          <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: CLICK_COLOR }} aria-hidden="true" />
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p id="track-name-click" className="truncate text-sm font-semibold text-foreground">Click</p>
              <p className="truncate text-xs text-muted-foreground" title={summary}>{summary}</p>
            </div>
            <button
              type="button"
              onClick={() => onChange({ enabled: !s.enabled })}
              aria-pressed={!s.enabled}
              aria-label="Mute click"
              title="Click on/off (C). The click is not affected by solo."
              className={cn(ms, !s.enabled ? 'bg-red-600 text-white hover:bg-red-700' : msOff)}
            >
              M
            </button>
          </div>
          <VolumeFader label="Click volume" valueDb={s.volumeDb} onChange={(db) => onChange({ volumeDb: db })} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">Bypasses the master fader</p>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={panelId}
              className={cn('inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-daw-control hover:text-foreground', dawFocus)}
            >
              {open ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
              Settings
            </button>
          </div>
        </div>

        <div className="flex items-center bg-daw-lane px-2">
          <div
            ref={bodyRef}
            role="presentation"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              seek(e.clientX);
            }}
            onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && seek(e.clientX)}
            className="relative w-full cursor-pointer select-none"
            style={{ height: LANE_H }}
            title="Click to seek"
          >
            {s.enabled && width > 0 && (
              <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${LANE_H}`} preserveAspectRatio="none">
                <path d={paths.beats} className="stroke-daw-beat" strokeWidth={1} />
                <path d={paths.bars} className="stroke-daw-bar" strokeWidth={1.5} />
              </svg>
            )}
            {!sharedPlayhead && duration > 0 && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-daw-playhead" style={{ left: `${Math.min(100, Math.max(0, (pos / duration) * 100))}%` }} />
            )}
          </div>
        </div>
      </div>

      {open && (
        <div id={panelId} className="border-t border-daw-border bg-daw-surface px-4 py-2.5">
          {children}
        </div>
      )}
    </div>
  );
}
