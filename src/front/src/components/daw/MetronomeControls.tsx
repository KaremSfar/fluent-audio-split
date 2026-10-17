import { useId, useState } from 'react';
import { AudioWaveform, ChevronDown, ChevronRight, Metronome, Minus, Plus, Target, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VolumeFader } from './VolumeFader';
import {
  BEATS_PER_BAR_MAX,
  BEATS_PER_BAR_MIN,
  BPM_MAX,
  BPM_MIN,
  clampBpm,
  type AccentLevel,
  type MetronomeSettings,
  type Subdivision,
} from './metronome';
import type { AnchorKind } from './beatGrid';
import { formatClock } from './useTransportPos';
import { Divider } from './Divider';
import { caption, ctl, ctlIcon, field, ghost, neutral, on, segItem, segTrack, toggle } from './ui';

export interface AnalysisSummary {
  bpm: number;
  beats: number;
  confidence: number;
  source: string;
  /** Whether Follow mode was switched on automatically. */
  followed: boolean;
  /** First downbeat time, for "Use as fixed tempo". */
  downbeatSec: number;
  /** Beats at the start that were extended back from where the beat is first detected (0 = none). */
  leadInBeats: number;
  /** Where the beat is first detected, in seconds. */
  confidentFromSec: number;
}

interface MetronomeControlsProps {
  settings: MetronomeSettings;
  onChange: (patch: Partial<MetronomeSettings>) => void;
  onTap: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
  /** 0..1 while analyzing. */
  analyzeProgress: number;
  canAnalyze: boolean;
  analyzeError: string | null;
  summary: AnalysisSummary | null;
  onDismissSummary: () => void;
  onUseFixed: () => void;
  onSetDownbeat: () => void;
  onNudge: (deltaSec: number) => void;
  onAnchor: (kind: AnchorKind) => void;
  onRemoveAnchor: (index: number) => void;
  onClearAnchors: () => void;
  onHalf: () => void;
  onDouble: () => void;
  practice: boolean;
  onTogglePractice: () => void;
  canPractice: boolean;
}

/** Compact (24 px) control for the Advanced panel. */
const mini = cn(ctl, 'h-7 px-2');

const SUBDIVISIONS: { value: Subdivision; label: string }[] = [
  { value: 1, label: 'Off' },
  { value: 2, label: '8ths' },
  { value: 3, label: 'Triplets' },
  { value: 4, label: '16ths' },
];
const ACCENT_NAMES = ['off', 'normal', 'accent'] as const;
const ANCHOR_NAMES: Record<AnchorKind, string> = { beat: 'beat', downbeat: 'beat 1', bar1: 'beat 1 (phase)' };

export function MetronomeControls(p: MetronomeControlsProps) {
  const s = p.settings;
  const follow = s.mode === 'follow';
  const hasMap = !!s.map;
  // null = not editing: show the committed value.
  const [draft, setDraft] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const advancedId = useId();

  const commit = () => {
    const v = Number(draft);
    if (draft !== null && draft !== '' && Number.isFinite(v)) p.onChange({ bpm: clampBpm(v) });
    setDraft(null);
  };
  const setAccent = (i: number) => {
    const next = [...s.accents] as AccentLevel[];
    next[i] = (((next[i] ?? 1) + 1) % 3) as AccentLevel;
    p.onChange({ accents: next });
  };
  const gap = (patch: Partial<MetronomeSettings['gap']>) => p.onChange({ gap: { ...s.gap, ...patch } });

  return (
    <div className="flex flex-col gap-2.5">
      {/* ── Click + tempo ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => p.onChange({ enabled: !s.enabled })}
            aria-pressed={s.enabled}
            title="Metronome (C)"
            className={cn(ctl, 'pl-2', toggle(s.enabled))}
          >
            <Metronome className="size-4" aria-hidden="true" /> Click
          </button>
          <div role="group" aria-label="Click timing" className={segTrack}>
            <button
              type="button"
              aria-pressed={!follow}
              onClick={() => p.onChange({ mode: 'fixed' })}
              className={segItem(!follow)}
              title="Constant tempo (BPM + downbeat offset)"
            >
              Fixed tempo
            </button>
            <button
              type="button"
              aria-pressed={follow}
              disabled={!hasMap}
              onClick={() => p.onChange({ mode: 'follow' })}
              className={segItem(follow)}
              title={hasMap ? 'Follow the analysed beat map (handles tempo drift)' : 'Analyze the song first'}
            >
              Follow song
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {follow ? (
            <span className="text-xs tabular-nums text-muted-foreground" title="Average tempo of the beat map">
              Map ≈{s.map?.bpm.toFixed(1)} BPM · {s.map?.beats.length} beats
            </span>
          ) : (
            <>
              <div className="flex items-center" role="group" aria-label="Tempo">
                <button
                  type="button"
                  className={cn(ctlIcon, neutral, 'rounded-r-none')}
                  aria-label="Decrease tempo"
                  onClick={(e) => p.onChange({ bpm: clampBpm(s.bpm - (e.shiftKey ? 0.1 : 1)) })}
                >
                  <Minus className="size-3.5" />
                </button>
                <label className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={BPM_MIN}
                    max={BPM_MAX}
                    step={0.1}
                    value={draft ?? s.bpm.toFixed(1)}
                    aria-label="Tempo in BPM"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit();
                    }}
                    className={cn(field, 'w-[88px] rounded-none border-x-0 pr-9 text-right font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none')}
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground" aria-hidden="true">
                    BPM
                  </span>
                </label>
                <button
                  type="button"
                  className={cn(ctlIcon, neutral, 'rounded-l-none')}
                  aria-label="Increase tempo"
                  onClick={(e) => p.onChange({ bpm: clampBpm(s.bpm + (e.shiftKey ? 0.1 : 1)) })}
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <button type="button" onClick={p.onTap} title="Tap tempo (T)" className={cn(ctl, neutral)}>
                Tap
              </button>
            </>
          )}
          <button
            type="button"
            onClick={p.onAnalyze}
            disabled={!p.canAnalyze || p.analyzing}
            aria-busy={p.analyzing}
            title="Map every beat of the song (uses the drums stem if there is one) so the click can follow tempo drift"
            className={cn(ctl, neutral, 'pl-2')}
          >
            <AudioWaveform className="size-4" aria-hidden="true" />
            {p.analyzing ? `Analyzing… ${Math.round(p.analyzeProgress * 100)}%` : hasMap ? 'Re-analyze' : 'Analyze'}
          </button>
        </div>

        <Divider />

        <div className="flex items-center gap-3">
          <label className={cn(caption, 'flex items-center gap-1.5')}>
            Beats/bar
            <select value={s.beatsPerBar} onChange={(e) => p.onChange({ beatsPerBar: Number(e.target.value) })} className={field}>
              {Array.from({ length: BEATS_PER_BAR_MAX - BEATS_PER_BAR_MIN + 1 }, (_, i) => i + BEATS_PER_BAR_MIN).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className={cn(caption, 'flex items-center gap-1.5')}>
            Count-in
            <select
              value={s.countInBars}
              onChange={(e) => p.onChange({ countInBars: Number(e.target.value) as 0 | 1 | 2 })}
              className={field}
            >
              <option value={0}>Off</option>
              <option value={1}>1 bar</option>
              <option value={2}>2 bars</option>
            </select>
          </label>
        </div>

      </div>

      {/* ── Grid alignment + Advanced toggle ───────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="Grid alignment">
          <span className={cn(caption, 'min-w-[124px] tabular-nums')}>
            {follow ? 'Beat 1 alignment' : `Downbeat ${s.offsetSec.toFixed(3)} s`}
          </span>
          <button type="button" className={cn(mini, neutral)} onClick={() => p.onNudge(-0.01)} aria-label="Nudge grid 10 milliseconds earlier" title="[">
            −10 ms
          </button>
          <button type="button" className={cn(mini, neutral)} onClick={() => p.onNudge(0.01)} aria-label="Nudge grid 10 milliseconds later" title="]">
            +10 ms
          </button>
          <button
            type="button"
            className={cn(mini, neutral)}
            onClick={p.onSetDownbeat}
            title={follow ? 'Make the beat nearest the playhead beat 1 (D)' : 'Set downbeat at the playhead (D)'}
          >
            Set at playhead
          </button>
        </div>
        <Divider />
        <div className="flex items-center gap-3">
          <div className="flex w-60 shrink-0 items-center gap-2" title="The click bypasses the master fader, so it stays audible when the mix is pulled down.">
            <span className={cn(caption, 'shrink-0')}>Click vol</span>
            <VolumeFader label="Click volume" valueDb={s.volumeDb} onChange={(db) => p.onChange({ volumeDb: db })} className="flex-1" />
          </div>
          <button
            type="button"
            onClick={p.onTogglePractice}
            disabled={!p.canPractice && !p.practice}
            aria-pressed={p.practice}
            title={
              p.practice
                ? 'Leave click practice and restore the previous mix (P)'
                : 'Click practice: mute every stem but the focused one, click on, 1-bar count-in (P)'
            }
            className={cn(mini, 'pl-1.5', toggle(p.practice))}
          >
            <Target className="size-3.5" aria-hidden="true" />
            {p.practice ? 'Exit practice' : 'Practice'}
          </button>
        </div>
        <button
          type="button"
          aria-expanded={advanced}
          aria-controls={advancedId}
          onClick={() => setAdvanced((v) => !v)}
          className={cn(mini, ghost, 'ml-auto gap-1 pl-1.5')}
        >
          {advanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} Advanced
        </button>
      </div>

      {p.analyzing && (
        <div
          role="progressbar"
          aria-label="Beat analysis progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p.analyzeProgress * 100)}
          className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-daw-control"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(p.analyzeProgress * 100)}%` }} />
        </div>
      )}

      {p.summary && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-daw-border bg-daw-lane px-3 py-1.5 text-xs" role="status">
          <span>
            Beat map from {p.summary.source}: ≈{p.summary.bpm.toFixed(1)} BPM, {p.summary.beats} beats, confidence{' '}
            {Math.round(p.summary.confidence * 100)}%.
            {p.summary.leadInBeats > 0 &&
              p.summary.confidentFromSec >= 2 &&
              ` The beat is first detected at ${formatClock(p.summary.confidentFromSec).slice(0, 8)}; the ${p.summary.leadInBeats} beats before it are extended back from there.`}
            {p.summary.followed
              ? ' The click now follows the song.'
              : ' Low confidence: the click may not lock to this song.'}
          </span>
          {!follow && (
            <button type="button" onClick={() => p.onChange({ mode: 'follow' })} className={cn(mini, on)}>
              Follow anyway
            </button>
          )}
          <button type="button" onClick={p.onUseFixed} className={cn(mini, neutral)} title="Use the average tempo and first downbeat as a fixed grid">
            Use as fixed tempo
          </button>
          <button type="button" onClick={p.onDismissSummary} className={cn(mini, ghost, 'w-7 px-0')} aria-label="Dismiss analysis summary">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {p.analyzeError && <p className="text-xs text-red-700 dark:text-red-300" role="status">{p.analyzeError}</p>}

      {/* ── Advanced ──────────────────────────────────────────── */}
      {advanced && (
        <div id={advancedId} className="flex flex-col gap-3 rounded-md border border-daw-border bg-daw-lane p-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1">
              Subdivision
              <select
                value={s.subdivision}
                onChange={(e) => p.onChange({ subdivision: Number(e.target.value) as Subdivision })}
                className={cn(field, 'h-7')}
              >
                {SUBDIVISIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-1" role="group" aria-label="Accent pattern">
              <span>Accents</span>
              {Array.from({ length: s.beatsPerBar }, (_, i) => {
                const lvl = s.accents[i] ?? 1;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setAccent(i)}
                    aria-label={`Beat ${i + 1}: ${ACCENT_NAMES[lvl]}. Change`}
                    title="Cycle off / normal / accent"
                    className={cn(
                      mini,
                      'w-7 px-0 font-mono',
                      lvl === 2 ? on : lvl === 1 ? 'bg-daw-control-hover text-foreground' : 'border border-dashed border-daw-border bg-transparent text-muted-foreground',
                    )}
                  >
                    {lvl === 0 ? '·' : i + 1}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-pressed={s.flash}
              onClick={() => p.onChange({ flash: !s.flash })}
              className={cn(mini, toggle(s.flash))}
              title="Flash the screen edge on each beat (off when your system asks for reduced motion)"
            >
              Beat flash
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Gap click">
            <button
              type="button"
              aria-pressed={s.gap.enabled}
              onClick={() => gap({ enabled: !s.gap.enabled })}
              className={cn(mini, toggle(s.gap.enabled))}
              title="Mute the click for stretches to test your own time (G)"
            >
              Gap click
            </button>
            <label className="flex items-center gap-1">
              on
              <input
                type="number"
                min={1}
                max={16}
                value={s.gap.onBars}
                onChange={(e) => gap({ onBars: Number(e.target.value) })}
                className={cn(field, 'h-7 w-12')}
                aria-label="Bars with click"
              />
              bars
            </label>
            <label className="flex items-center gap-1">
              silent
              <input
                type="number"
                min={1}
                max={16}
                value={s.gap.offBars}
                onChange={(e) => gap({ offBars: Number(e.target.value) })}
                className={cn(field, 'h-7 w-12')}
                aria-label="Silent bars"
              />
              bars
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={s.gap.visualCue} onChange={(e) => gap({ visualCue: e.target.checked })} />
              show beat while silent
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tempo map">
            <button type="button" onClick={p.onHalf} className={cn(mini, neutral)} title="Half time (every other beat)">
              ½× Half
            </button>
            <button type="button" onClick={p.onDouble} className={cn(mini, neutral)} title="Double time (add the off-beats)">
              2× Double
            </button>
            {follow && (
              <>
                <button type="button" onClick={() => p.onAnchor('beat')} className={cn(mini, neutral)} title="This is a beat: pull the nearest map beat onto the playhead (A)">
                  Anchor beat
                </button>
                <button type="button" onClick={() => p.onAnchor('downbeat')} className={cn(mini, neutral)} title="This is beat 1: pull the nearest map beat onto the playhead and start a bar there (Shift+A)">
                  Anchor beat 1
                </button>
              </>
            )}
          </div>
          {follow && (
            <>
              <p className="text-muted-foreground">
                For exact anchors, pause and click the waveform right on the hit. Anchors set while playing include your reaction time.
              </p>
              {s.anchors.length > 0 && (
                <div className="flex flex-col gap-1">
                  <ul className="flex max-h-24 flex-wrap gap-1 overflow-y-auto" aria-label="Anchors">
                    {s.anchors.map((a, i) => (
                      <li key={`${a.kind}:${a.pos}`} className="flex items-center gap-1 rounded-md bg-daw-control pl-2 text-foreground">
                        <span className="font-mono tabular-nums">{formatClock(a.pos)}</span>
                        <span className="text-muted-foreground">{ANCHOR_NAMES[a.kind]}</span>
                        <button
                          type="button"
                          onClick={() => p.onRemoveAnchor(i)}
                          aria-label={`Remove ${ANCHOR_NAMES[a.kind]} anchor at ${formatClock(a.pos)}`}
                          className={cn(mini, ghost, 'w-7 px-0')}
                        >
                          <X className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={p.onClearAnchors} className={cn(mini, neutral, 'self-start')}>
                    Clear anchors
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
