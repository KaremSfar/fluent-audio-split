import { describe, expect, it } from 'vitest';
import { clampDb, dbToFaderPos, dbToGain, dbValueText, faderPosToDb, formatDb, gainToDb } from './gain';

describe('gain', () => {
  it('converts dB and linear gain', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(-Infinity)).toBe(0);
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0)).toBe(-Infinity);
  });

  it('puts 0 dB at 80% of the fader and +6 dB at the top', () => {
    expect(faderPosToDb(0.8)).toBeCloseTo(0, 9);
    expect(faderPosToDb(1)).toBe(6);
    expect(faderPosToDb(0)).toBe(-Infinity);
  });

  it('is strictly monotonic', () => {
    let prev = -Infinity;
    for (let p = 0.001; p <= 1; p += 0.001) {
      const db = faderPosToDb(p);
      expect(db).toBeGreaterThan(prev);
      prev = db;
    }
  });

  it('round-trips position -> dB -> position', () => {
    for (const p of [0.05, 0.1, 0.25, 0.4, 0.5, 0.65, 0.8, 0.9, 1]) {
      expect(dbToFaderPos(faderPosToDb(p))).toBeCloseTo(p, 9);
    }
    expect(dbToFaderPos(-Infinity)).toBe(0);
    expect(dbToFaderPos(12)).toBe(1);
  });

  it('formats dB values', () => {
    expect(formatDb(-Infinity)).toBe('−∞ dB');
    expect(formatDb(-3)).toBe('−3.0 dB');
    expect(formatDb(2.5)).toBe('+2.5 dB');
    expect(formatDb(0)).toBe('0.0 dB');
    expect(formatDb(-0.04)).toBe('0.0 dB');
    expect(dbValueText(-Infinity)).toBe('silent');
  });

  it('clamps', () => {
    expect(clampDb(20)).toBe(6);
    expect(clampDb(-100)).toBe(-Infinity);
    expect(clampDb(-3)).toBe(-3);
  });
});
