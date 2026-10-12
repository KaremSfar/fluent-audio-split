import { describe, expect, it } from 'vitest';
import { defaultMixer, isAudible, mixerReducer, parseMixer, serializeMixer, type MixerState } from './useMixerState';

const run = (s: MixerState, ...actions: Parameters<typeof mixerReducer>[1][]) =>
  actions.reduce(mixerReducer, s);

describe('mixerReducer', () => {
  it('everything is audible by default', () => {
    const s = defaultMixer();
    expect(isAudible(s, 'a')).toBe(true);
  });

  it('solo is additive', () => {
    const s = run(defaultMixer(), { type: 'toggleSolo', id: 'a' }, { type: 'toggleSolo', id: 'b' });
    expect(isAudible(s, 'a')).toBe(true);
    expect(isAudible(s, 'b')).toBe(true);
    expect(isAudible(s, 'c')).toBe(false);
  });

  it('exclusive solo replaces other solos and toggles off', () => {
    let s = run(defaultMixer(), { type: 'toggleSolo', id: 'a' }, { type: 'toggleSolo', id: 'b' });
    s = run(s, { type: 'toggleSolo', id: 'c', exclusive: true });
    expect(isAudible(s, 'c')).toBe(true);
    expect(isAudible(s, 'a')).toBe(false);
    s = run(s, { type: 'toggleSolo', id: 'c', exclusive: true });
    expect(isAudible(s, 'a')).toBe(true);
  });

  it('mute overrides solo', () => {
    const s = run(defaultMixer(), { type: 'toggleSolo', id: 'a' }, { type: 'toggleMute', id: 'a' });
    expect(isAudible(s, 'a')).toBe(false);
  });

  it('un-soloing restores earlier mutes', () => {
    let s = run(defaultMixer(), { type: 'toggleMute', id: 'b' }, { type: 'toggleSolo', id: 'a' });
    expect(isAudible(s, 'b')).toBe(false);
    s = run(s, { type: 'clearSolo' });
    expect(isAudible(s, 'a')).toBe(true);
    expect(isAudible(s, 'b')).toBe(false);
  });

  it('clamps volume and keeps -Infinity', () => {
    let s = run(defaultMixer(), { type: 'setVolume', id: 'a', db: 40 });
    expect(s.tracks.a.volumeDb).toBe(6);
    s = run(s, { type: 'setVolume', id: 'a', db: -Infinity });
    expect(s.tracks.a.volumeDb).toBe(-Infinity);
  });

  it('round-trips through storage, including -Infinity and bad data', () => {
    const s = run(
      defaultMixer(),
      { type: 'setVolume', id: 'a', db: -Infinity },
      { type: 'setVolume', id: 'b', db: -3.5 },
      { type: 'toggleMute', id: 'b' },
      { type: 'setMaster', db: -2 },
      { type: 'setMetronome', patch: { enabled: true, bpm: 98.4, countInBars: 2 } },
    );
    expect(parseMixer(serializeMixer(s))).toEqual(s);
    expect(parseMixer('not json')).toEqual(defaultMixer());
    expect(parseMixer(null)).toEqual(defaultMixer());
  });

  it('round-trips the v2 click settings (mode, map, anchors, subdivision, accents, gap, practice)', () => {
    const map = { beats: [0.25, 0.75, 1.25, 1.75, 2.25], downbeatIndex: 1, bpm: 120, confidence: 0.8 };
    const s = run(
      defaultMixer(),
      { type: 'setMetronome', patch: { map, mode: 'follow', anchors: [{ pos: 1.3, kind: 'downbeat' }] } },
      { type: 'setMetronome', patch: { subdivision: 3, beatsPerBar: 7, flash: true } },
      { type: 'setMetronome', patch: { gap: { enabled: true, onBars: 4, offBars: 2, visualCue: false } } },
      { type: 'enterPractice', keepId: 'a', ids: ['a', 'b'] },
    );
    expect(s.metronome.accents).toEqual([2, 1, 1, 1, 1, 1, 1]);
    expect(parseMixer(serializeMixer(s))).toEqual(s);
  });

  it('drops a corrupt beat map and falls back to fixed mode', () => {
    const raw = JSON.stringify({ metronome: { mode: 'follow', map: { beats: [1, 0.5] }, anchors: 'x', accents: [9, 9] } });
    const s = parseMixer(raw);
    expect(s.metronome.map).toBeNull();
    expect(s.metronome.mode).toBe('fixed');
    expect(s.metronome.anchors).toEqual([]);
    expect(s.metronome.accents).toEqual([2, 1, 1, 1]);
  });

  it('resizes the accent pattern when beats per bar changes, keeping the prefix', () => {
    let s = run(defaultMixer(), { type: 'setMetronome', patch: { accents: [2, 0, 2, 1] } });
    s = run(s, { type: 'setMetronome', patch: { beatsPerBar: 5 } });
    expect(s.metronome.accents).toEqual([2, 0, 2, 1, 1]);
  });

  it('click practice mutes all but one track and restores the previous mix on exit', () => {
    const before = run(
      defaultMixer(),
      { type: 'toggleSolo', id: 'c' },
      { type: 'setVolume', id: 'b', db: -4 },
      { type: 'setMetronome', patch: { countInBars: 2 } },
    );
    let s = run(before, { type: 'enterPractice', keepId: 'b', ids: ['a', 'b', 'c'] });
    expect(['a', 'b', 'c'].map((id) => isAudible(s, id))).toEqual([false, true, false]);
    expect(s.metronome.enabled).toBe(true);
    expect(s.metronome.countInBars).toBe(1);
    s = run(s, { type: 'toggleMute', id: 'a' }, { type: 'exitPractice' });
    expect(s.tracks).toEqual(before.tracks);
    expect(s.metronome).toEqual(before.metronome);
    expect(s.practice).toBeNull();
  });
});
