import { useEffect, useState } from 'react';
import { Play, Pause, Loader2, Volume2, VolumeX, Headphones } from 'lucide-react';
import { StemWaveformPlayer } from './StemWaveformPlayer';
import { StemSyncEngine } from './stemSyncEngine';

export interface StemsPlayerGroupProps {
  /** Stem display name → storage path, e.g. `node.outputArtifactPaths`. The path doubles as the
   *  stem's stable id in the engine registry — every artifact has a distinct path. */
  stems: Record<string, string>;
  /** Compact layout for the in-canvas execution drawer; full layout otherwise. */
  compact?: boolean;
  onDownload: (path: string) => void;
  /**
   * Shared across every node execution's `StemsPlayerGroup` on the page (see `ExecutionPage` /
   * `ExecutionDrawer`, which create one and pass it to every node). All stems — whichever node
   * they came from — play through this one engine's single `AudioContext` clock, so stems in
   * different nodes start in exact phase and can neither drift nor echo. Playing this node joins
   * whatever is already playing, and seeking any waveform moves the whole page. Optional: a
   * private engine is created when none is supplied, so the group still works standalone.
   */
  engine?: StemSyncEngine;
}

/**
 * DAW-style stem player for a single node execution: one master transport for the whole node —
 * pressing Play (lazily) decodes every stem and starts them all on the shared engine clock, instead
 * of each stem having its own play button. Per-stem rows only carry Mute and Solo, so you mix stems
 * that are already playing in sync rather than starting independent, unsynced clips.
 */
export function StemsPlayerGroup({ stems, compact = false, onDownload, engine: engineProp }: StemsPlayerGroupProps) {
  const entries = Object.entries(stems);
  const ids = entries.map(([, path]) => path);

  // Fall back to a private engine when no page-level one is supplied, so the group still works
  // standalone. `new StemSyncEngine()` is cheap — it opens no `AudioContext` until the first play.
  const [localEngine] = useState(() => new StemSyncEngine());
  const engine = engineProp ?? localEngine;
  // Only the local engine is ours to tear down; the shared one is owned by the page.
  useEffect(() => () => { if (!engineProp) localEngine.release(); }, [engineProp, localEngine]);

  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [mutedMap, setMutedMap] = useState<Record<string, boolean>>({});

  // The engine rewinds and notifies every group when the song reaches its end — reset this node's
  // master Play/Pause so pressing Play restarts from the top instead of resuming at the very end.
  useEffect(() => engine.onTransportEnded(() => setIsPlaying(false)), [engine]);

  const handleMasterPlayPause = async () => {
    if (loadState === 'loading') return;

    if (isPlaying) {
      engine.pause(ids);
      setIsPlaying(false);
      return;
    }

    // Resume the shared AudioContext *synchronously*, inside this click and before any await, or
    // the browser's autoplay policy keeps it suspended and nothing is audible.
    engine.ensureContext();

    if (loadState !== 'ready') {
      setLoadState('loading');
      // Each stem surfaces its own error state; one bad stem shouldn't block starting the rest.
      await engine.prepare(ids).catch(() => {});
      setLoadState('ready');
    }
    // Start this node's stems on the shared clock — joining any already-playing node in exact phase.
    engine.play(ids);
    setIsPlaying(true);
  };

  const handleToggleMute = (stem: string) => {
    setMutedMap((prev) => {
      const next = !prev[stem];
      engine.setMuted(stems[stem], next);
      return { ...prev, [stem]: next };
    });
  };

  const handleToggleSolo = (stem: string) => {
    // "Soloed" means this stem is unmuted and every other stem is muted. Soloing an
    // already-soloed stem is a toggle: it unmutes everyone again.
    const isSoloed = !mutedMap[stem] && entries.every(([s]) => s === stem || mutedMap[s]);
    setMutedMap(() => {
      const next: Record<string, boolean> = {};
      for (const [s, path] of entries) {
        const muted = isSoloed ? false : s !== stem;
        next[s] = muted;
        engine.setMuted(path, muted);
      }
      return next;
    });
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
                <StemWaveformPlayer id={path} path={path} engine={engine} compact />
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
                <StemWaveformPlayer id={path} path={path} engine={engine} />
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
