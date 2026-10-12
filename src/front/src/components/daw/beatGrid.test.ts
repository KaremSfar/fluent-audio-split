import { describe, expect, it } from 'vitest';
import {
  FixedGrid,
  MapGrid,
  applyAnchors,
  barBeatAt,
  barRegion,
  barSeekTarget,
  bpmAt,
  buildGrid,
  doubleTime,
  halfTime,
  nearestBarLine,
  sanitizeAnchors,
  sanitizeMap,
  shiftMap,
  type TempoMap,
} from './beatGrid';

const map = (beats: number[], downbeatIndex = 0): TempoMap => ({ beats, downbeatIndex, bpm: 120, confidence: 1 });
const even = (n: number, spb = 0.5, start = 0) => Array.from({ length: n }, (_, i) => start + i * spb);

describe('FixedGrid', () => {
  it('places beats from bpm + offset and numbers bars from the offset', () => {
    const g = new FixedGrid(120, 0.25, 4);
    expect(g.beatTime(0)).toBe(0.25);
    expect(g.beatTime(3)).toBe(1.75);
    expect(g.beatIndexAt(1.25)).toBe(2);
    expect(barBeatAt(g, 2.3)).toEqual({ bar: 2, beat: 1 });
    expect(barBeatAt(g, 0)).toEqual({ bar: 0, beat: 4 });
    expect(bpmAt(g, 10)).toBeCloseTo(120, 9);
  });
});

describe('MapGrid', () => {
  it('is an exact, invertible map inside and extrapolates with the local tempo outside', () => {
    const beats = [1, 1.5, 2, 2.5, 3, 3.4, 3.8, 4.2];
    const g = new MapGrid(beats, [0], 4);
    expect(g.beatTime(5)).toBe(3.4);
    expect(g.beatIndexAt(3.6)).toBeCloseTo(5.5, 9);
    expect(g.beatTime(8)).toBeCloseTo(4.6, 9);
    expect(g.beatTime(-1)).toBeCloseTo(0.5, 9);
    expect(g.beatIndexAt(0.5)).toBeCloseTo(-1, 9);
    for (const k of [-3, 0, 4, 7, 10]) expect(g.beatIndexAt(g.beatTime(k))).toBeCloseTo(k, 9);
    expect(bpmAt(g, 1.2)).toBeCloseTo(120, 6);
    expect(bpmAt(g, 4)).toBeCloseTo(150, 6);
  });

  it('re-phases bars from each downbeat ref, keeping bar numbers continuous', () => {
    const g = new MapGrid(even(16), [0, 6], 4);
    // Beats 0-3 bar 0, beats 4-5 a short bar 1, beat 6 starts bar 2.
    expect([0, 3, 4, 5, 6, 9, 10].map((k) => [g.barIndex(k), g.beatInBar(k)])).toEqual([
      [0, 0], [0, 3], [1, 0], [1, 1], [2, 0], [2, 3], [3, 0],
    ]);
  });
});

describe('applyAnchors', () => {
  const beats = even(20);

  it('snaps the nearest beat onto a single anchor, holds after, fades in over 4 beats before', () => {
    const { beats: out } = applyAnchors(map(beats), [{ pos: 5.05, kind: 'beat' }]);
    expect(out[10]).toBeCloseTo(5.05, 9);
    expect(out[15]).toBeCloseTo(7.55, 9);
    expect(out[9]).toBeCloseTo(4.5 + 0.05 * 0.75, 9);
    expect(out[6]).toBeCloseTo(3, 9);
    expect(out[0]).toBe(0);
  });

  it('interpolates corrections between two anchors', () => {
    const { beats: out } = applyAnchors(map(beats), [
      { pos: 2.0, kind: 'beat' },
      { pos: 6.08, kind: 'beat' },
    ]);
    expect(out[4]).toBeCloseTo(2.0, 9);
    expect(out[12]).toBeCloseTo(6.08, 9);
    expect(out[8]).toBeCloseTo(4.04, 9);
    expect(out[16]).toBeCloseTo(8.08, 9);
  });

  it('extends the map to reach anchors outside it and keeps the downbeat index stable', () => {
    const { beats: out, downbeatRefs } = applyAnchors(map(even(8, 0.5, 2), 1), [{ pos: 0.98, kind: 'beat' }]);
    // Two beats were prepended (1.0, 1.5) → the base downbeat index shifts by 2.
    expect(out.length).toBe(10);
    expect(out[0]).toBeCloseTo(0.98, 9);
    expect(downbeatRefs).toEqual([3]);
  });

  it('downbeat and bar-1 anchors override the analysed downbeat', () => {
    const r1 = applyAnchors(map(beats, 1), [{ pos: 3.0, kind: 'downbeat' }]);
    expect(r1.downbeatRefs).toEqual([6]);
    const r2 = applyAnchors(map(beats, 1), [{ pos: 3.6, kind: 'bar1' }]);
    expect(r2.downbeatRefs).toEqual([7]);
    expect(r2.beats).toEqual(beats); // phase only
    const g = buildGrid({ mode: 'follow', bpm: 0, offsetSec: 0, beatsPerBar: 4, map: map(beats, 1), anchors: [{ pos: 3.6, kind: 'bar1' }] });
    expect(barBeatAt(g, 3.5).beat).toBe(1);
    expect(barBeatAt(g, 0).beat).toBe(2);
  });

  it('never folds the timeline back on conflicting anchors', () => {
    const { beats: out } = applyAnchors(map(beats), [
      { pos: 2.0, kind: 'beat' },
      { pos: 2.3, kind: 'beat' },
    ]);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
  });
});

describe('map edits and bar helpers', () => {
  it('half/double time round-trips and keeps beat 1', () => {
    const m = map(even(16), 2);
    const h = halfTime(m);
    expect(h.beats).toEqual(even(8, 1));
    expect(h.beats[h.downbeatIndex]).toBe(1);
    const d = doubleTime(h);
    expect(d.beats.slice(0, 15)).toEqual(even(15));
    expect(d.beats[d.downbeatIndex]).toBe(1);
    expect(shiftMap(m, 0.01).beats[1]).toBeCloseTo(0.51, 9);
  });

  it('bar regions, seek targets and bar-line snapping follow the grid', () => {
    const g = new FixedGrid(120, 0, 4);
    expect(barRegion(g, 2.7, 1)).toEqual({ start: 2, end: 4 });
    expect(barRegion(g, 2.7, 4)).toEqual({ start: 2, end: 10 });
    expect(barSeekTarget(g, 2.7, 1)).toBe(4);
    expect(barSeekTarget(g, 2.7, -1)).toBe(2);
    expect(barSeekTarget(g, 2.05, -1)).toBe(0);
    expect(nearestBarLine(g, 2.9)).toBe(2);
    expect(nearestBarLine(g, 3.1)).toBe(4);
  });

  it('sanitizes persisted maps and anchors', () => {
    expect(sanitizeMap({ beats: [0, 1, 0.5] })).toBeNull();
    expect(sanitizeMap({ beats: [0] })).toBeNull();
    expect(sanitizeMap({ beats: [0, 0.5, 1], downbeatIndex: 9 })?.downbeatIndex).toBe(2);
    expect(sanitizeAnchors([{ pos: 1, kind: 'beat' }, { pos: 'x', kind: 'beat' }, { pos: 2, kind: 'nope' }])).toEqual([
      { pos: 1, kind: 'beat' },
    ]);
  });
});
