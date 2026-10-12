import { useEffect, useReducer } from 'react';
import { clampDb } from './gain';
import {
  BEATS_PER_BAR_MAX,
  BEATS_PER_BAR_MIN,
  BPM_MAX,
  BPM_MIN,
  DEFAULT_GAP,
  DEFAULT_METRONOME,
  resizeAccents,
  type AccentLevel,
  type GapConfig,
  type MetronomeSettings,
} from './metronome';
import { sanitizeAnchors, sanitizeMap } from './beatGrid';

export interface TrackMix {
  volumeDb: number;
  muted: boolean;
  soloed: boolean;
}

/** What "Click practice" changed, so leaving it restores the previous mix exactly. */
export interface PracticeSnapshot {
  tracks: Record<string, TrackMix>;
  clickEnabled: boolean;
  countInBars: 0 | 1 | 2;
  keepId: string;
}

export interface MixerState {
  tracks: Record<string, TrackMix>;
  masterDb: number;
  metronome: MetronomeSettings;
  /** Non-null while the Click practice preset is active. */
  practice: PracticeSnapshot | null;
}

export type MixerAction =
  | { type: 'setVolume'; id: string; db: number }
  | { type: 'toggleMute'; id: string }
  | { type: 'toggleSolo'; id: string; exclusive?: boolean }
  | { type: 'clearSolo' }
  | { type: 'setMaster'; db: number }
  | { type: 'setMetronome'; patch: Partial<MetronomeSettings> }
  /** Mute every track in `ids` except `keepId`, clear solos, click on with a 1-bar count-in. */
  | { type: 'enterPractice'; keepId: string; ids: string[] }
  | { type: 'exitPractice' }
  | { type: 'hydrate'; state: MixerState };

export const DEFAULT_TRACK: TrackMix = { volumeDb: 0, muted: false, soloed: false };

export const defaultMixer = (): MixerState => ({
  tracks: {},
  masterDb: 0,
  metronome: { ...DEFAULT_METRONOME },
  practice: null,
});

export const trackMix = (s: MixerState, id: string): TrackMix => s.tracks[id] ?? DEFAULT_TRACK;

/** Mute and solo are independent flags; a track is audible when not muted and (no solos or it is soloed). */
export function isAudible(s: MixerState, id: string): boolean {
  const t = trackMix(s, id);
  const anySolo = Object.values(s.tracks).some((x) => x.soloed);
  return !t.muted && (!anySolo || t.soloed);
}

export const anySoloed = (s: MixerState): boolean => Object.values(s.tracks).some((x) => x.soloed);

function patchTrack(s: MixerState, id: string, patch: Partial<TrackMix>): MixerState {
  return { ...s, tracks: { ...s.tracks, [id]: { ...trackMix(s, id), ...patch } } };
}

export function mixerReducer(s: MixerState, a: MixerAction): MixerState {
  switch (a.type) {
    case 'setVolume':
      return patchTrack(s, a.id, { volumeDb: clampDb(a.db) });
    case 'toggleMute':
      return patchTrack(s, a.id, { muted: !trackMix(s, a.id).muted });
    case 'toggleSolo': {
      const wasSoloed = trackMix(s, a.id).soloed;
      if (a.exclusive) {
        // Alt: solo only this track (or clear everything if it was already the only solo).
        const others = Object.entries(s.tracks).some(([k, t]) => k !== a.id && t.soloed);
        const tracks: Record<string, TrackMix> = {};
        for (const [k, t] of Object.entries(s.tracks)) tracks[k] = { ...t, soloed: false };
        const solo = !(wasSoloed && !others);
        tracks[a.id] = { ...trackMix({ ...s, tracks }, a.id), soloed: solo };
        return { ...s, tracks };
      }
      return patchTrack(s, a.id, { soloed: !wasSoloed });
    }
    case 'clearSolo': {
      const tracks: Record<string, TrackMix> = {};
      for (const [k, t] of Object.entries(s.tracks)) tracks[k] = { ...t, soloed: false };
      return { ...s, tracks };
    }
    case 'setMaster':
      return { ...s, masterDb: clampDb(a.db) };
    case 'setMetronome':
      return { ...s, metronome: sanitizeMetronome({ ...s.metronome, ...a.patch }) };
    case 'enterPractice': {
      if (s.practice) return s;
      const tracks: Record<string, TrackMix> = { ...s.tracks };
      for (const id of new Set([...a.ids, ...Object.keys(s.tracks)])) {
        tracks[id] = { ...trackMix(s, id), muted: id !== a.keepId, soloed: false };
      }
      return {
        ...s,
        tracks,
        metronome: { ...s.metronome, enabled: true, countInBars: 1 },
        practice: {
          tracks: s.tracks,
          clickEnabled: s.metronome.enabled,
          countInBars: s.metronome.countInBars,
          keepId: a.keepId,
        },
      };
    }
    case 'exitPractice':
      if (!s.practice) return s;
      return {
        ...s,
        tracks: s.practice.tracks,
        metronome: { ...s.metronome, enabled: s.practice.clickEnabled, countInBars: s.practice.countInBars },
        practice: null,
      };
    case 'hydrate':
      return a.state;
  }
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const int = (v: unknown, fallback: number, min: number, max: number) => Math.round(num(v, fallback, min, max));

function sanitizeGap(g: unknown): GapConfig {
  if (!g || typeof g !== 'object') return DEFAULT_GAP;
  const o = g as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    onBars: int(o.onBars, DEFAULT_GAP.onBars, 1, 16),
    offBars: int(o.offBars, DEFAULT_GAP.offBars, 1, 16),
    visualCue: typeof o.visualCue === 'boolean' ? o.visualCue : DEFAULT_GAP.visualCue,
  };
}

function sanitizeAccents(v: unknown, beatsPerBar: number): AccentLevel[] {
  const a = Array.isArray(v) ? v.filter((x): x is AccentLevel => x === 0 || x === 1 || x === 2) : [];
  return resizeAccents(a, beatsPerBar);
}

/**
 * Validate/complete metronome settings from reducer patches (our own code: map/anchors are trusted,
 * so they keep their identity and the metronome only rebuilds its grid when they really change).
 * Persisted data goes through {@link parseMetronome} first.
 */
export function sanitizeMetronome(m: Partial<MetronomeSettings>): MetronomeSettings {
  const d = DEFAULT_METRONOME;
  const beatsPerBar = int(m.beatsPerBar, d.beatsPerBar, BEATS_PER_BAR_MIN, BEATS_PER_BAR_MAX);
  const map = m.map ?? null;
  const accents =
    Array.isArray(m.accents) && m.accents.length === beatsPerBar && m.accents.every((x) => x === 0 || x === 1 || x === 2)
      ? m.accents
      : sanitizeAccents(m.accents, beatsPerBar);
  const sub = m.subdivision;
  return {
    enabled: typeof m.enabled === 'boolean' ? m.enabled : d.enabled,
    bpm: Math.round(num(m.bpm, d.bpm, BPM_MIN, BPM_MAX) * 10) / 10,
    beatsPerBar,
    offsetSec: num(m.offsetSec, d.offsetSec, -3600, 3600),
    volumeDb: m.volumeDb === -Infinity ? -Infinity : clampDb(num(m.volumeDb, d.volumeDb, -90, 6)),
    countInBars: m.countInBars === 1 || m.countInBars === 2 ? m.countInBars : 0,
    mode: m.mode === 'follow' && map ? 'follow' : 'fixed',
    map,
    anchors: Array.isArray(m.anchors) ? m.anchors : [],
    subdivision: sub === 2 || sub === 3 || sub === 4 ? sub : 1,
    accents,
    gap: sanitizeGap(m.gap),
    flash: m.flash === true,
  };
}

/** Untrusted (persisted) metronome settings → valid settings. */
function parseMetronome(o: Record<string, unknown>): MetronomeSettings {
  return sanitizeMetronome({
    ...(o as Partial<MetronomeSettings>),
    volumeDb: o.volumeDb === null ? -Infinity : (o.volumeDb as number),
    map: sanitizeMap(o.map),
    anchors: sanitizeAnchors(o.anchors),
    accents: Array.isArray(o.accents) ? sanitizeAccents(o.accents, int(o.beatsPerBar, 4, BEATS_PER_BAR_MIN, BEATS_PER_BAR_MAX)) : undefined,
  });
}

const storageKey = (executionId: string) => `fas:mixer:v2:${executionId}`;

// JSON has no -Infinity, so it is stored as null.
const toJsonDb = (db: number) => (db === -Infinity ? null : db);
const fromJsonDb = (v: unknown, fallback: number) => (v === null ? -Infinity : clampDb(num(v, fallback, -90, 6)));

const tracksToJson = (tracks: Record<string, TrackMix>) =>
  Object.fromEntries(Object.entries(tracks).map(([k, t]) => [k, { ...t, volumeDb: toJsonDb(t.volumeDb) }]));

function tracksFromJson(v: unknown): Record<string, TrackMix> {
  const tracks: Record<string, TrackMix> = {};
  if (!v || typeof v !== 'object') return tracks;
  for (const [k, t] of Object.entries(v as Record<string, Record<string, unknown> | null>)) {
    if (!t || typeof t !== 'object') continue;
    tracks[k] = { volumeDb: fromJsonDb(t.volumeDb, 0), muted: t.muted === true, soloed: t.soloed === true };
  }
  return tracks;
}

/** Storage format v2 (adds mode, beat map, anchors, subdivision, accents, gap, flash, practice). */
export function serializeMixer(s: MixerState): string {
  const m = s.metronome;
  return JSON.stringify({
    v: 2,
    masterDb: toJsonDb(s.masterDb),
    metronome: {
      ...m,
      volumeDb: toJsonDb(m.volumeDb),
      // 0.1 ms is far below audibility and keeps a 5-minute map around 6 KB.
      map: m.map ? { ...m.map, beats: m.map.beats.map((t) => Math.round(t * 1e4) / 1e4) } : null,
    },
    tracks: tracksToJson(s.tracks),
    practice: s.practice ? { ...s.practice, tracks: tracksToJson(s.practice.tracks) } : null,
  });
}

/** Parses persisted mixer state. Bad data → defaults. */
export function parseMixer(raw: string | null): MixerState {
  const base = defaultMixer();
  if (!raw) return base;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return base;
    const p = o.practice as Record<string, unknown> | null | undefined;
    const practice: PracticeSnapshot | null =
      p && typeof p === 'object' && typeof p.keepId === 'string'
        ? {
            tracks: tracksFromJson(p.tracks),
            clickEnabled: p.clickEnabled === true,
            countInBars: p.countInBars === 1 || p.countInBars === 2 ? p.countInBars : 0,
            keepId: p.keepId,
          }
        : null;
    return {
      tracks: tracksFromJson(o.tracks),
      masterDb: fromJsonDb(o.masterDb, 0),
      metronome: parseMetronome((o.metronome && typeof o.metronome === 'object' ? o.metronome : {}) as Record<string, unknown>),
      practice,
    };
  } catch {
    return base;
  }
}

function load(executionId: string): MixerState {
  try {
    return parseMixer(localStorage.getItem(storageKey(executionId)));
  } catch {
    return defaultMixer();
  }
}

/** Mixer state for one execution, persisted to localStorage (debounced). */
export function useMixerState(executionId: string) {
  const [state, dispatch] = useReducer(mixerReducer, executionId, load);

  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(storageKey(executionId), serializeMixer(state));
      } catch {
        // Storage full / unavailable: the mix just won't persist.
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [executionId, state]);

  return [state, dispatch] as const;
}
