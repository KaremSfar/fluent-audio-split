import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from '@/auth/useAuth';
import { resultsService } from '@/services/resultsService';
import { executionsService } from '@/services/executionsService';
import { workflowsService } from '@/services/workflowsService';
import { filesService } from '@/services/filesService';
import { useExecutionStream } from '@/hooks/useExecutionStream';
import { Download, Keyboard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/execution/StatusBadge';
import { StemSyncEngine, type LoopRegion } from '@/components/execution/stemSyncEngine';
import { TransportBar } from '@/components/daw/TransportBar';
import { TimeRuler } from '@/components/daw/TimeRuler';
import { TrackLane } from '@/components/daw/TrackLane';
import { ClickLane } from '@/components/daw/ClickLane';
import { MasterStrip } from '@/components/daw/MasterStrip';
import { MetronomeControls, type AnalysisSummary } from '@/components/daw/MetronomeControls';
import { BeatFlash } from '@/components/daw/BeatFlash';
import { AddTrackPopover } from '@/components/daw/AddTrackPopover';
import { ShortcutsDialog } from '@/components/daw/ShortcutsDialog';
import { EmptyResults } from '@/components/daw/EmptyResults';
import { LanesOverlay } from '@/components/daw/LanesOverlay';
import { useDawShortcuts } from '@/components/daw/useDawShortcuts';
import { useMeters } from '@/components/daw/useMeters';
import { anySoloed, isAudible, trackMix, useMixerState } from '@/components/daw/useMixerState';
import { encodeMp3, encodeWav16, renderMixdown, type MixSource } from '@/components/daw/mixdown';
import { Metronome, TapTempo, clampBpm, type MetronomeSettings } from '@/components/daw/metronome';
import {
  barRegion,
  barSeekTarget,
  beatIndexFloor,
  buildGrid,
  doubleTime,
  halfTime,
  nearestBarLine,
  shiftMap,
  type AnchorKind,
} from '@/components/daw/beatGrid';
import { formatClock } from '@/components/daw/useTransportPos';
import { dbToGain } from '@/components/daw/gain';
import { analyzeBeats } from '@/components/daw/beatAnalysis';
import type { AvailableStem, ExecutionResults, ResultTrack } from '@/types/results';
import type {
  ExecutionStatusEvent,
  NodeStatusEvent,
  WorkflowExecution,
  WorkflowExecutionStatus,
} from '@/types/execution';

const TERMINAL: WorkflowExecutionStatus[] = ['Completed', 'PartiallyFailed', 'Failed', 'Cancelled'];
const LARGE_TRACK_COUNT = 10;
const LARGE_BYTES = 1.5 * 1024 ** 3;
const UNDO_MS = 6000;
/** Analyses at or above this confidence switch the click to Follow song automatically. */
const FOLLOW_CONFIDENCE = 0.35;
/** Fewer beats than this is not a usable map. */
const MIN_MAP_BEATS = 8;
const ANCHOR_LABEL: Record<AnchorKind, string> = { beat: 'Beat', downbeat: 'Beat 1', bar1: 'Beat 1' };

const WIDE_QUERY = '(min-width: 768px)';
function subscribeWide(cb: () => void) {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
/** Two-column (md+) lane layout, where one shared playhead is drawn over all lanes. */
function useWideLayout(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true);
}

function isNotFound(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}

export default function ResultsPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login');
  }, [isAuthenticated, isLoading, navigate]);

  const { data, isLoading: dataLoading, error } = useQuery({
    queryKey: ['results', id],
    queryFn: () => resultsService.get(id!),
    enabled: !!id && isAuthenticated,
    retry: (count, err) => !isNotFound(err) && count < 2,
  });

  if (isLoading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!data || !id) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">
          {error && !isNotFound(error) ? 'Couldn’t load results.' : 'Execution not found.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate('/executions')}>← Executions</Button>
      </div>
    );
  }

  // Keyed by execution so the engine, mixer and metronome reset when navigating between runs.
  return <ResultsView key={id} executionId={id} results={data} />;
}

function ResultsView({ executionId, results }: { executionId: string; results: ExecutionResults }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Engine / metronome ──────────────────────────────────────────────────────
  const [engine] = useState(() => new StemSyncEngine());
  useEffect(() => () => engine.release(), [engine]);
  const [metronome] = useState(() => new Metronome(engine));
  useEffect(() => {
    metronome.connect();
    return () => metronome.dispose();
  }, [metronome]);

  const [mixer, dispatch] = useMixerState(executionId);
  useEffect(() => metronome.update(mixer.metronome), [metronome, mixer.metronome]);
  const setClick = useCallback((patch: Partial<MetronomeSettings>) => dispatch({ type: 'setMetronome', patch }), [dispatch]);
  // Same derivation the metronome uses internally, for the ruler, readouts, flash and bar snapping.
  const { mode, bpm, offsetSec, beatsPerBar, map, anchors } = mixer.metronome;
  const grid = useMemo(
    () => buildGrid({ mode, bpm, offsetSec, beatsPerBar, map, anchors }),
    [mode, bpm, offsetSec, beatsPerBar, map, anchors],
  );

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [loadedTick, setLoadedTick] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((msg: string) => setAnnouncement(msg), []);
  const { bus, clipped, resetClip } = useMeters(engine, playing);

  useEffect(
    () =>
      engine.onTransportChange((kind, t) => {
        setPlaying(t.running);
        if (kind === 'play') announce('Playing');
        else if (kind === 'pause' || kind === 'end') announce('Paused');
      }),
    [engine, announce],
  );

  // ── Live status (SSE while the run is in progress) ───────────────────────────
  const [liveStatus, setLiveStatus] = useState<WorkflowExecutionStatus>(results.status);
  // A refetched server status supersedes the last live event (adjusted during render, not in an effect).
  const [seenStatus, setSeenStatus] = useState(results.status);
  if (seenStatus !== results.status) {
    setSeenStatus(results.status);
    setLiveStatus(results.status);
  }
  const running = !TERMINAL.includes(liveStatus);

  const { data: execution } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => executionsService.get(executionId),
  });
  const { data: workflow } = useQuery({
    queryKey: ['workflow', results.workflowId],
    queryFn: () => workflowsService.get(results.workflowId),
  });
  const refetchResults = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['results', executionId] }),
    [queryClient, executionId],
  );
  const onNodeStatus = useCallback(
    (ev: NodeStatusEvent) => {
      if (ev.status === 'Completed' || ev.status === 'Failed') {
        refetchResults();
        void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
      }
    },
    [refetchResults, queryClient, executionId],
  );
  const onExecutionStatus = useCallback(
    (ev: ExecutionStatusEvent) => {
      setLiveStatus(ev.status);
      if (TERMINAL.includes(ev.status)) {
        refetchResults();
        void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
      }
    },
    [refetchResults, queryClient, executionId],
  );
  const onSnapshot = useCallback(
    (fresh: WorkflowExecution) => {
      setLiveStatus(fresh.status);
      refetchResults();
      queryClient.setQueryData(['execution', executionId], fresh);
    },
    [refetchResults, queryClient, executionId],
  );
  useExecutionStream({ executionId, onNodeStatus, onExecutionStatus, onSnapshot, enabled: running });

  // ── Tracks ───────────────────────────────────────────────────────────────────
  const tracks = useMemo(() => [...results.tracks].sort((a, b) => a.sortOrder - b.sortOrder), [results.tracks]);
  const readyTracks = useMemo(() => tracks.filter((t) => t.state === 'Ready' && t.artifactPath), [tracks]);
  const readyKey = readyTracks.map((t) => `${t.id}|${t.artifactPath}`).join(',');

  const loadIds = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      void Promise.allSettled(
        ids.map(async (tid) => {
          await engine.prepare([tid]);
          // A stem that finishes loading mid-playback joins the transport in exact phase.
          if (engine.getTransport().running && engine.isLoaded(tid)) engine.play([tid]);
        }),
      ).then(() => {
        setDuration(engine.getTransport().duration);
        setLoadedTick((n) => n + 1);
      });
    },
    [engine],
  );

  useEffect(() => {
    // Lane children registered with the engine in this same commit (child effects run first).
    loadIds(readyTracks.filter((t) => !engine.isLoaded(t.id)).map((t) => t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey, engine, loadIds]);

  // Push the mixer into the engine (also after each load, since entries are created lazily).
  useEffect(() => {
    for (const t of readyTracks) {
      engine.setVolume(t.id, dbToGain(trackMix(mixer, t.id).volumeDb));
      engine.setMuted(t.id, !isAudible(mixer, t.id));
    }
    engine.setMasterVolume(dbToGain(mixer.masterDb));
  }, [engine, mixer, readyTracks, loadedTick]);

  const decodedBytes = useMemo(() => {
    void loadedTick;
    let total = 0;
    for (const t of readyTracks) {
      const b = engine.getBuffer(t.id);
      if (b) total += b.length * b.numberOfChannels * 4;
    }
    return total;
  }, [engine, readyTracks, loadedTick]);
  // Reads engine state; `loadedTick` re-renders us whenever a load settles.
  const loadingAny = useMemo(() => {
    void loadedTick;
    return readyTracks.some((t) => !engine.isLoaded(t.id));
  }, [engine, readyTracks, loadedTick]);
  const largeSession = readyTracks.length > LARGE_TRACK_COUNT || decodedBytes > LARGE_BYTES;

  // ── Mutations ────────────────────────────────────────────────────────────────
  const [undo, setUndo] = useState<{ track: ResultTrack } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const addMutation = useMutation({
    mutationFn: (s: { workflowNodeId: string; outputName: string; displayName: string }) =>
      resultsService.addTrack(executionId, { workflowNodeId: s.workflowNodeId, outputName: s.outputName }),
    onSuccess: (_t, s) => {
      announce(`${s.displayName} added`);
      refetchResults();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (t: ResultTrack) => resultsService.removeTrack(executionId, t.id),
    onSuccess: (_v, t) => {
      announce(`${t.displayName} removed`);
      refetchResults();
      setUndo({ track: t });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
    },
  });

  const addStem = (s: AvailableStem) => addMutation.mutate(s);

  // ── Transport actions ────────────────────────────────────────────────────────
  const loadedIds = () => engine.registeredIds().filter((tid) => engine.isLoaded(tid));

  const playPause = () => {
    // Must run synchronously inside the gesture (autoplay policy).
    engine.ensureContext();
    if (engine.getTransport().running) {
      engine.pause(engine.registeredIds());
      return;
    }
    const ids = loadedIds();
    if (ids.length === 0) {
      announce(loadingAny ? 'Tracks are still loading' : 'Nothing to play');
      return;
    }
    const delaySec = metronome.prepareCountIn();
    engine.play(ids, { delaySec });
  };
  const toStart = () => engine.seek(0);
  const stop = () => {
    engine.pause(engine.registeredIds());
    engine.seek(0);
  };
  const seekBy = (direction: -1 | 1, unit: 'bar' | 'sec') => {
    const pos = Math.max(0, engine.nowPos());
    if (unit === 'bar' && mixer.metronome.enabled) engine.seek(Math.max(0, barSeekTarget(grid, pos, direction)));
    else engine.seek(pos + direction * (unit === 'bar' ? 1 : 5));
  };

  // ── Loop (bar-snapped A–B) ───────────────────────────────────────────────────
  const [loop, setLoopState] = useState<LoopRegion | null>(null);
  const applyLoop = (region: LoopRegion | null) => {
    engine.setLoop(region);
    const actual = engine.getLoop();
    setLoopState(actual);
    if (!actual) announce('Loop off');
    else {
      const k0 = beatIndexFloor(grid, actual.start + 1e-3);
      const k1 = beatIndexFloor(grid, actual.end - 1e-3);
      announce(`Looping bars ${grid.barIndex(k0) + 1} to ${grid.barIndex(k1) + 1}`);
    }
  };
  const loopBars = (bars: number) => applyLoop(barRegion(grid, Math.max(0, engine.nowPos()), bars));
  const loopEdge = (pos: number) => {
    if (!loop) return applyLoop(barRegion(grid, pos, 1));
    const snapped = nearestBarLine(grid, pos);
    const startSide = Math.abs(snapped - loop.start) <= Math.abs(snapped - loop.end);
    let next = startSide ? { start: snapped, end: loop.end } : { start: loop.start, end: snapped };
    if (next.end - next.start < 0.05) next = barRegion(grid, pos, 1);
    applyLoop(next);
  };

  // ── Metronome UI actions ─────────────────────────────────────────────────────
  const tapRef = useRef(new TapTempo());
  const tap = () => {
    const tapped = tapRef.current.tap(performance.now());
    if (tapped != null) {
      setClick({ bpm: tapped, mode: 'fixed' });
      announce(`Tempo ${Math.round(tapped)} BPM`);
    }
  };

  // Beat analysis (Web Worker) → tempo map.
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const analyzeAbort = useRef<AbortController | null>(null);
  useEffect(() => () => analyzeAbort.current?.abort(), []);
  const analyze = async () => {
    const loaded = readyTracks.filter((t) => engine.isLoaded(t.id));
    const buffers = loaded.map((t) => engine.getBuffer(t.id)).filter((b): b is AudioBuffer => !!b);
    if (buffers.length === 0) return;
    const names = loaded.map((t) =>
      t.displayName.toLowerCase().includes(t.outputName.toLowerCase()) ? t.displayName : `${t.displayName} · ${t.outputName}`,
    );
    analyzeAbort.current?.abort();
    const ac = new AbortController();
    analyzeAbort.current = ac;
    setAnalyzing(true);
    setAnalyzeProgress(0);
    setAnalyzeError(null);
    setSummary(null);
    announce('Analyzing beats');
    try {
      const r = await analyzeBeats(buffers, names, {
        beatsPerBar: mixer.metronome.beatsPerBar,
        onProgress: setAnalyzeProgress,
        signal: ac.signal,
      });
      if (r.beats.length < MIN_MAP_BEATS) {
        setAnalyzeError('Couldn’t find a steady beat. Use Fixed tempo with Tap instead.');
        announce('No steady beat found');
        return;
      }
      const followed = r.confidence >= FOLLOW_CONFIDENCE;
      setClick({
        map: { beats: r.beats, downbeatIndex: r.downbeatIndex, bpm: r.bpm, confidence: r.confidence },
        ...(followed ? { mode: 'follow' as const } : {}),
      });
      setSummary({
        bpm: r.bpm,
        beats: r.beats.length,
        confidence: r.confidence,
        source: r.source,
        followed,
        downbeatSec: r.beats[r.downbeatIndex],
        leadInBeats: r.leadInBeats,
        confidentFromSec: r.beats[r.leadInBeats] ?? 0,
      });
      announce(
        `Beat map ready: about ${Math.round(r.bpm)} BPM, confidence ${Math.round(r.confidence * 100)} percent` +
          (followed ? ', click follows the song' : ''),
      );
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error(err);
      setAnalyzeError('Beat analysis failed. Try again, or use Fixed tempo with Tap.');
    } finally {
      if (analyzeAbort.current === ac) setAnalyzing(false);
    }
  };

  const follow = mixer.metronome.mode === 'follow' && !!map;
  const playheadPos = () => Math.round(Math.max(0, engine.nowPos()) * 1000) / 1000;
  const addAnchor = (kind: AnchorKind) => {
    if (!follow) {
      announce('Analyze the song and switch to Follow song to add anchors');
      return;
    }
    const pos = playheadPos();
    // One anchor per spot: replace any anchor within 40 ms.
    const rest = anchors.filter((a) => Math.abs(a.pos - pos) > 0.04);
    setClick({ anchors: [...rest, { pos, kind }] });
    announce(`${ANCHOR_LABEL[kind]} anchored at ${formatClock(pos)}`);
  };
  const setDownbeat = () => {
    if (follow) addAnchor('bar1');
    else setClick({ offsetSec: playheadPos() });
  };
  const nudge = (delta: number) => {
    if (follow && map) setClick({ map: shiftMap(map, delta) });
    else setClick({ offsetSec: Math.round((mixer.metronome.offsetSec + delta) * 1000) / 1000 });
  };
  const scaleTempo = (factor: 0.5 | 2) => {
    if (follow && map) {
      const next = factor === 2 ? doubleTime(map) : halfTime(map);
      setClick({ map: next });
      announce(`Beat map ${factor === 2 ? 'doubled' : 'halved'}: about ${Math.round(next.bpm)} BPM`);
    } else {
      const next = clampBpm(mixer.metronome.bpm * factor);
      setClick({ bpm: next });
      announce(`Tempo ${Math.round(next)} BPM`);
    }
  };
  const toggleGap = () => {
    const g = mixer.metronome.gap;
    setClick({ gap: { ...g, enabled: !g.enabled } });
    announce(g.enabled ? 'Gap click off' : `Gap click on: ${g.onBars} bars on, ${g.offBars} bars silent`);
  };

  // Click practice: keep only the focused (else first) track, click on, 1-bar count-in; exit restores.
  const togglePractice = () => {
    if (mixer.practice) {
      dispatch({ type: 'exitPractice' });
      announce('Click practice off, previous mix restored');
      return;
    }
    const keep = focused ?? readyTracks[0];
    if (!keep) return;
    dispatch({ type: 'enterPractice', keepId: keep.id, ids: readyTracks.map((t) => t.id) });
    announce(`Click practice: only ${keep.displayName} plays, click on, 1 bar count-in`);
  };

  // ── Focused track + shortcuts ────────────────────────────────────────────────
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = readyTracks.find((t) => t.id === focusedId) ?? null;
  const [help, setHelp] = useState(false);
  const closeHelp = useCallback(() => setHelp(false), []);

  useDawShortcuts({
    playPause,
    toStart,
    seekBy: (dir, unit) => seekBy(dir, unit),
    toggleClick: () => {
      setClick({ enabled: !mixer.metronome.enabled });
      announce(mixer.metronome.enabled ? 'Click off' : 'Click on');
    },
    tap,
    setDownbeat,
    nudge,
    anchor: (downbeat) => addAnchor(downbeat ? 'downbeat' : 'beat'),
    loop: (fourBars) => (fourBars ? loopBars(4) : loop ? applyLoop(null) : loopBars(1)),
    toggleGap,
    togglePractice,
    focusTrack: (n) => {
      const lane = document.querySelector<HTMLElement>(`[data-track-lane="${n - 1}"]`);
      lane?.focus();
    },
    muteFocused: () => focused && dispatch({ type: 'toggleMute', id: focused.id }),
    soloFocused: (exclusive) => focused && dispatch({ type: 'toggleSolo', id: focused.id, exclusive }),
    clearSolos: () => dispatch({ type: 'clearSolo' }),
    volumeFocused: (delta) =>
      focused && dispatch({ type: 'setVolume', id: focused.id, db: trackMix(mixer, focused.id).volumeDb + delta }),
    resetFocused: () => focused && dispatch({ type: 'setVolume', id: focused.id, db: 0 }),
    help: () => setHelp(true),
  });

  // ── Render ───────────────────────────────────────────────────────────────────
  const canvasHref = `/workflows/${results.workflowId}`;
  const detailsHref = `/executions/${executionId}`;
  const doneNodes = (execution?.nodeExecutions ?? []).filter((n) => n.status === 'Completed').length;
  const totalNodes = workflow?.nodes.length;
  const anySolo = anySoloed(mixer);
  const fileName = results.inputFile.originalFileName;
  const empty = tracks.length === 0;
  const wide = useWideLayout();

  // ── Export: render the mix as heard (faders, mute/solo, master) to a WAV download ──
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav');
  const [exporting, setExporting] = useState(false);
  const exportMix = useCallback(async () => {
    const sources = new Map<string, MixSource>();
    for (const t of readyTracks) {
      const b = engine.getBuffer(t.id);
      if (b) sources.set(t.id, b);
    }
    const mix = renderMixdown(sources, mixer, readyTracks.map((t) => t.id));
    if (!mix) {
      announce('Nothing to export: no audible tracks');
      return;
    }
    setExporting(true);
    try {
      const blob = exportFormat === 'mp3' ? await encodeMp3(mix) : encodeWav16(mix);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.replace(/\.[^.]+$/, '')} - mix.${exportFormat}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      announce(`Exported ${mix.included.length} ${mix.included.length === 1 ? 'track' : 'tracks'} as ${exportFormat.toUpperCase()}`);
    } catch {
      announce('Export failed');
    } finally {
      setExporting(false);
    }
  }, [engine, readyTracks, mixer, fileName, announce, exportFormat]);
  const canExport = !loadingAny && readyTracks.some((t) => isAudible(mixer, t.id));

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AppHeader onLogoClick={() => navigate('/dashboard')}>
        <Link to={canvasHref}><Button variant="outline" size="sm">Open canvas</Button></Link>
        <Link to={detailsHref}><Button variant="outline" size="sm">Execution details</Button></Link>
      </AppHeader>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{results.workflowName}</h1>
            <StatusBadge status={liveStatus} />
            {duration > 0 && <span className="text-sm text-muted-foreground">{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as 'wav' | 'mp3')}
                aria-label="Export format"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="wav">WAV</option>
                <option value="mp3">MP3 (192 kbps)</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void exportMix()}
                disabled={!canExport || exporting}
                title="Download the mix as heard: audible tracks at their fader levels, plus master volume"
              >
                {exporting ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" /> : <Download className="mr-1.5 size-4" aria-hidden="true" />}
                {exporting ? 'Exporting…' : 'Export mix'}
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Results for <span className="font-medium text-foreground">{fileName}</span>
            {results.trimStartSeconds != null && results.trimEndSeconds != null &&
              ` (trimmed ${results.trimStartSeconds.toFixed(1)}–${results.trimEndSeconds.toFixed(1)} s)`}
          </p>
        </div>

        {running && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm dark:border-violet-500/30 dark:bg-violet-500/10">
            <span>
              Still running · {doneNodes}{totalNodes ? `/${totalNodes}` : ''} nodes done
            </span>
            <Link to={canvasHref} className="text-link hover:underline">Open canvas</Link>
          </div>
        )}
        {largeSession && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Large session — playback may use a lot of memory.
          </p>
        )}

        <section
          aria-label="Mixer"
          className="flex min-h-[440px] flex-1 flex-col overflow-clip rounded-xl border border-daw-border bg-daw-lane text-foreground shadow-sm"
        >
          <TransportBar
            engine={engine}
            playing={playing}
            loading={loadingAny}
            duration={duration}
            metronome={mixer.metronome}
            grid={grid}
            isGapSilentAt={(p) => metronome.isGapSilentAt(p)}
            loop={loop}
            onLoopBars={loopBars}
            onClearLoop={() => applyLoop(null)}
            onPlayPause={playPause}
            onStop={stop}
            onToStart={toStart}
            master={
              <MasterStrip
                valueDb={mixer.masterDb}
                onChange={(db) => dispatch({ type: 'setMaster', db })}
                bus={bus}
                clipped={clipped}
                onResetClip={resetClip}
              />
            }
          />

          {empty && !running ? (
            <EmptyResults
              failed={liveStatus === 'Failed'}
              canvasHref={canvasHref}
              detailsHref={detailsHref}
              available={results.available}
              onAdd={addStem}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 border-b border-daw-border md:grid-cols-[300px_minmax(0,1fr)]">
                <div className="hidden items-center justify-between gap-2 border-r border-daw-border bg-daw-surface px-4 text-xs text-muted-foreground md:flex">
                  <span>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>
                  {anySolo && (
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'clearSolo' })}
                      className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-950 hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Clear all solos (Shift+S)"
                    >
                      Solo on · Clear
                    </button>
                  )}
                </div>
                <div className="px-2">
                  <TimeRuler
                    engine={engine}
                    duration={duration}
                    grid={grid}
                    showGrid={mixer.metronome.enabled}
                    anchors={follow ? anchors : []}
                    loop={loop}
                    onLoopEdge={loopEdge}
                  />
                </div>
              </div>
              <div className="relative flex flex-1 flex-col">
                <ClickLane
                  engine={engine}
                  duration={duration}
                  grid={grid}
                  settings={mixer.metronome}
                  onChange={(patch) => {
                    setClick(patch);
                    if (patch.mode) announce(patch.mode === 'follow' ? 'Click follows the song' : 'Fixed tempo click');
                  }}
                  sharedPlayhead={wide}
                >
                <MetronomeControls
                  settings={mixer.metronome}
                  onChange={(patch) => {
                    setClick(patch);
                    if (patch.mode) announce(patch.mode === 'follow' ? 'Click follows the song' : 'Fixed tempo click');
                  }}
                  onTap={tap}
                  onAnalyze={() => void analyze()}
                  analyzing={analyzing}
                  analyzeProgress={analyzeProgress}
                  canAnalyze={decodedBytes > 0}
                  analyzeError={analyzeError}
                  summary={summary}
                  onDismissSummary={() => setSummary(null)}
                  onUseFixed={() => {
                    if (!summary) return;
                    setClick({ mode: 'fixed', bpm: clampBpm(summary.bpm), offsetSec: Math.round(summary.downbeatSec * 1000) / 1000 });
                    announce(`Fixed tempo ${summary.bpm.toFixed(1)} BPM applied`);
                    setSummary(null);
                  }}
                  onSetDownbeat={setDownbeat}
                  onNudge={nudge}
                  onAnchor={addAnchor}
                  onRemoveAnchor={(i) => {
                    setClick({ anchors: anchors.filter((_, j) => j !== i) });
                    announce('Anchor removed');
                  }}
                  onClearAnchors={() => {
                    setClick({ anchors: [] });
                    announce('Anchors cleared');
                  }}
                  onHalf={() => scaleTempo(0.5)}
                  onDouble={() => scaleTempo(2)}
                  practice={!!mixer.practice}
                  onTogglePractice={togglePractice}
                  canPractice={readyTracks.length > 0}
                />
                </ClickLane>
                {tracks.map((t, i) => (
                  <TrackLane
                    key={t.id}
                    track={t}
                    index={i}
                    engine={engine}
                    bus={bus}
                    mix={trackMix(mixer, t.id)}
                    audible={isAudible(mixer, t.id)}
                    canvasHref={`${canvasHref}?exec=${executionId}&node=${t.workflowNodeId}`}
                    sharedPlayhead={wide}
                    onFocusTrack={setFocusedId}
                    onVolume={(db) => dispatch({ type: 'setVolume', id: t.id, db })}
                    onMute={() => dispatch({ type: 'toggleMute', id: t.id })}
                    onSolo={(exclusive) => dispatch({ type: 'toggleSolo', id: t.id, exclusive })}
                    onDownload={() => {
                      const ext = t.artifactPath?.split('.').pop() ?? 'mp3';
                      filesService.download(t.artifactPath!, `${t.displayName}.${ext}`).catch(console.error);
                    }}
                    onRemove={() => removeMutation.mutate(t)}
                    onRetryLoad={() => loadIds([t.id])}
                  />
                ))}
                {/* Empty arrangement area: the header column continues down to the footer. */}
                <div aria-hidden="true" className="hidden min-h-12 flex-1 md:grid md:grid-cols-[300px_minmax(0,1fr)]">
                  <div className="border-r border-daw-border bg-daw-surface" />
                  <div />
                </div>
                {wide && <LanesOverlay engine={engine} duration={duration} loop={loop} anchors={follow ? anchors : []} />}
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-daw-border bg-daw-surface px-4 py-2.5">
                <AddTrackPopover available={results.available} onAdd={addStem} disabled={addMutation.isPending} />
                <span className="text-xs text-muted-foreground">
                  Edits here apply to this run only. Pin stems on the canvas to keep them by default.
                </span>
                <button
                  type="button"
                  onClick={() => setHelp(true)}
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-daw-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Keyboard className="size-4" aria-hidden="true" /> Shortcuts <kbd className="rounded border border-daw-border px-1 font-mono text-[10px]">?</kbd>
                </button>
              </div>
            </>
          )}
        </section>
      </main>

      {undo && (
        <div role="status" className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg">
          <span>Removed {undo.track.displayName}</span>
          <button
            type="button"
            className="font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              addMutation.mutate({
                workflowNodeId: undo.track.workflowNodeId,
                outputName: undo.track.outputName,
                displayName: undo.track.displayName,
              });
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      )}

      <BeatFlash
        engine={engine}
        grid={grid}
        active={mixer.metronome.flash && mixer.metronome.enabled && playing}
        suppressAt={(p) => !mixer.metronome.gap.visualCue && metronome.isGapSilentAt(p)}
      />
      <div aria-live="polite" role="status" className="sr-only">{announcement}</div>
      <ShortcutsDialog open={help} onClose={closeHelp} />
    </div>
  );
}
