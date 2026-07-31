import { useRef, useState, type MutableRefObject } from 'react';
import { Play, Pause, Loader2, Volume2, VolumeX, Headphones } from 'lucide-react';
import { StemWaveformPlayer, type StemWaveformHandle } from './StemWaveformPlayer';

export interface StemsPlayerGroupProps {
  /** Stem display name → storage path, e.g. `node.outputArtifactPaths`. */
  stems: Record<string, string>;
  /** Compact layout for the in-canvas execution drawer; full layout otherwise. */
  compact?: boolean;
  onDownload: (path: string) => void;
  /**
   * Shared across every node execution's `StemsPlayerGroup` in the same page (see
   * `ExecutionPage`/`ExecutionDrawer`, which create one and pass it to every node). All stems —
   * whether from this node or another — were split from (or chained from) the same original
   * track, so they share one timeline: playing this node's stems while another node is already
   * playing joins that position instead of starting over at 0, and seeking any stem anywhere
   * moves every loaded stem in every node. Optional so the group still works standalone.
   */
  syncGroupRef?: MutableRefObject<Set<StemWaveformHandle>>;
}

/**
 * DAW-style stem player for a single node execution: one master transport for the whole node —
 * pressing Play (lazily) loads every stem and starts them all at the same time, instead of each
 * stem having its own play button. Per-stem rows only carry Mute and Solo, so you mix stems that
 * are already playing in sync rather than starting independent, unsynced clips.
 */
export function StemsPlayerGroup({ stems, compact = false, onDownload, syncGroupRef }: StemsPlayerGroupProps) {
  const entries = Object.entries(stems);
  // One imperative handle per stem, keyed by stem name — lets the master transport below drive
  // every stem's wavesurfer instance (load/play/pause/mute) without owning them directly.
  const handlesRef = useRef<Record<string, StemWaveformHandle | null>>({});
  // Falls back to a local, single-node registry when no page-level one is supplied, so this
  // component still works without cross-node wiring.
  const localSyncRef = useRef<Set<StemWaveformHandle>>(new Set());
  const syncRegistry = syncGroupRef ?? localSyncRef;

  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [mutedMap, setMutedMap] = useState<Record<string, boolean>>({});

  const forEachHandle = (fn: (handle: StemWaveformHandle) => void) => {
    for (const [stem] of entries) {
      const handle = handlesRef.current[stem];
      if (handle) fn(handle);
    }
  };

  const registerHandle = (stem: string, handle: StemWaveformHandle | null) => {
    const prev = handlesRef.current[stem];
    if (prev) syncRegistry.current.delete(prev);
    handlesRef.current[stem] = handle;
    if (handle) syncRegistry.current.add(handle);
  };

  // If a stem is already playing anywhere on the page (this node or another), line this node's
  // stems up at that same position before starting — that's what keeps whole nodes in sync with
  // each other, not just the stems within one node.
  const joinTimelineInProgress = () => {
    for (const handle of syncRegistry.current) {
      if (handle.isPlaying()) {
        const t = handle.getCurrentTime();
        forEachHandle((h) => h.setTime(t));
        return;
      }
    }
  };

  const handleMasterPlayPause = async () => {
    if (loadState === 'loading') return;

    if (loadState === 'idle') {
      setLoadState('loading');
      await Promise.all(entries.map(([stem]) => handlesRef.current[stem]?.load()));
      setLoadState('ready');
      joinTimelineInProgress();
      // Start every stem together — this is the whole point of a single master transport
      // instead of per-stem play buttons: nothing can start ahead of, or behind, anything else.
      await Promise.all(entries.map(([stem]) => handlesRef.current[stem]?.play()));
      setIsPlaying(true);
      return;
    }

    if (isPlaying) {
      forEachHandle((h) => h.pause());
      setIsPlaying(false);
    } else {
      joinTimelineInProgress();
      await Promise.all(entries.map(([stem]) => handlesRef.current[stem]?.play()));
      setIsPlaying(true);
    }
  };

  const handleToggleMute = (stem: string) => {
    setMutedMap((prev) => {
      const next = !prev[stem];
      handlesRef.current[stem]?.setMuted(next);
      return { ...prev, [stem]: next };
    });
  };

  const handleToggleSolo = (stem: string) => {
    // "Soloed" means this stem is unmuted and every other stem is muted. Soloing an
    // already-soloed stem is a toggle: it unmutes everyone again.
    const isSoloed = !mutedMap[stem] && entries.every(([s]) => s === stem || mutedMap[s]);
    setMutedMap(() => {
      const next: Record<string, boolean> = {};
      for (const [s] of entries) {
        const muted = isSoloed ? false : s !== stem;
        next[s] = muted;
        handlesRef.current[s]?.setMuted(muted);
      }
      return next;
    });
  };

  // Clicking/dragging on any stem's waveform anywhere on the page — this node or another — seeks
  // every loaded stem in every node to the exact same moment, otherwise seeking one would
  // silently pull it out of sync with the rest.
  const handleSeek = (time: number) => {
    for (const handle of syncRegistry.current) handle.setTime(time);
  };

  // A stem reaching the end on its own doesn't otherwise mark anything as stopped — without this
  // the master button would keep showing Pause, and pressing Play again would try to resume from
  // the very end (immediately finishing again) instead of restarting from the top.
  const handleFinish = () => {
    setIsPlaying(false);
    forEachHandle((h) => h.setTime(0));
  };

  const isLoading = loadState === 'loading';
  const masterButton = (
    <button
      type="button"
      onClick={handleMasterPlayPause}
      disabled={isLoading}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-60"
      title={isPlaying ? 'Pause all stems' : 'Play all stems in sync'}
      aria-label={isPlaying ? 'Pause all stems' : 'Play all stems in sync'}
    >
      {isLoading ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : isPlaying ? (
        <Pause className="size-3.5" />
      ) : (
        <Play className="size-3.5" />
      )}
    </button>
  );

  const rowControls = (stem: string) => {
    const muted = !!mutedMap[stem];
    const soloed = !muted && entries.every(([s]) => s === stem || mutedMap[s]);
    return { muted, soloed };
  };

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">Play all</span>
          {masterButton}
        </div>
        {entries.map(([stem, path]) => {
          const { muted, soloed } = rowControls(stem);
          return (
            <div key={stem} className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-violet-600 w-16 shrink-0 truncate text-right">
                {stem}
              </span>
              <button
                type="button"
                onClick={() => handleToggleMute(stem)}
                disabled={loadState !== 'ready'}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-violet-200 text-violet-500 hover:bg-violet-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                title={muted ? 'Unmute' : 'Mute'}
                aria-label={muted ? 'Unmute' : 'Mute'}
                aria-pressed={muted}
              >
                {muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
              </button>
              <div className="w-32">
                <StemWaveformPlayer
                  path={path}
                  compact
                  onSeek={handleSeek}
                  onFinish={handleFinish}
                  ref={(handle) => registerHandle(stem, handle)}
                />
              </div>
              <button
                type="button"
                onClick={() => handleToggleSolo(stem)}
                disabled={loadState !== 'ready'}
                className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md border ${soloed ? 'border-amber-400 bg-amber-100 text-amber-700' : 'border-violet-200 text-violet-500 hover:bg-violet-50'} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
                title={soloed ? 'Unsolo' : 'Solo (mute all other stems)'}
                aria-label={soloed ? 'Unsolo' : 'Solo'}
                aria-pressed={soloed}
              >
                <Headphones className="size-3" />
              </button>
              <button
                onClick={() => onDownload(path)}
                className="text-[10px] text-primary hover:underline px-1"
                title={`Download ${stem}`}
                aria-label={`Download ${stem}`}
              >
                ⬇
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">Output Stems</p>
        {masterButton}
        <span className="text-xs text-muted-foreground">
          {isPlaying ? 'Playing all in sync' : 'Play all'}
        </span>
      </div>
      <ul className="space-y-2">
        {entries.map(([stem, path]) => {
          const { muted, soloed } = rowControls(stem);
          return (
            <li key={stem} className="rounded-md border border-violet-100 bg-violet-50/40 p-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-violet-600 min-w-[80px] shrink-0">{stem}</span>
                <button
                  type="button"
                  onClick={() => handleToggleMute(stem)}
                  disabled={loadState !== 'ready'}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-violet-200 text-violet-500 hover:bg-violet-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title={muted ? 'Unmute' : 'Mute'}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  aria-pressed={muted}
                >
                  {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                </button>
                <StemWaveformPlayer
                  path={path}
                  onSeek={handleSeek}
                  onFinish={handleFinish}
                  ref={(handle) => registerHandle(stem, handle)}
                />
                <button
                  type="button"
                  onClick={() => handleToggleSolo(stem)}
                  disabled={loadState !== 'ready'}
                  className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md border ${soloed ? 'border-amber-400 bg-amber-100 text-amber-700' : 'border-violet-200 text-violet-500 hover:bg-violet-50'} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
                  title={soloed ? 'Unsolo' : 'Solo (mute all other stems)'}
                  aria-label={soloed ? 'Unsolo' : 'Solo'}
                  aria-pressed={soloed}
                >
                  <Headphones className="size-3.5" />
                </button>
                <button
                  onClick={() => onDownload(path)}
                  className="shrink-0 text-sm text-primary hover:underline"
                  title={`Download ${path.split('/').pop() ?? path}`}
                  aria-label={`Download ${stem}`}
                >
                  ⬇
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

