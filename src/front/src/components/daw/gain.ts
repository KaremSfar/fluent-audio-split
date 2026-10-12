/** dB / linear-gain helpers and the fader taper shared by every fader on the Results page. */

export const FADER_MIN_DB = -Infinity;
export const FADER_MAX_DB = 6;
/** Below this the fader is treated as fully down (−∞). */
const FLOOR_DB = -90;

/**
 * Fader taper: position p in [0,1] -> dB, piecewise-linear in dB. 0 dB sits at 80 % of the travel
 * and the 0…−20 dB region gets most of it. The first segment runs from the floor (−90 dB) rather
 * than a true −∞, which can't be interpolated; p = 0 itself is −∞.
 */
const TAPER: ReadonlyArray<readonly [number, number]> = [
  [0, FLOOR_DB],
  [0.05, -60],
  [0.25, -30],
  [0.5, -12],
  [0.8, 0],
  [1, FADER_MAX_DB],
];

export function dbToGain(db: number): number {
  return db === -Infinity || db <= FLOOR_DB ? 0 : Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

export function faderPosToDb(pos: number): number {
  if (!(pos > 0)) return -Infinity;
  if (pos >= 1) return FADER_MAX_DB;
  for (let i = 1; i < TAPER.length; i++) {
    const [p1, d1] = TAPER[i];
    if (pos <= p1) {
      const [p0, d0] = TAPER[i - 1];
      return d0 + ((pos - p0) / (p1 - p0)) * (d1 - d0);
    }
  }
  return FADER_MAX_DB;
}

export function dbToFaderPos(db: number): number {
  if (Number.isNaN(db) || db <= FLOOR_DB) return 0;
  if (db >= FADER_MAX_DB) return 1;
  for (let i = 1; i < TAPER.length; i++) {
    const [p1, d1] = TAPER[i];
    if (db <= d1) {
      const [p0, d0] = TAPER[i - 1];
      return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
    }
  }
  return 1;
}

/** `"−∞ dB"` / `"−3.0 dB"` / `"+2.5 dB"` (typographic minus). */
export function formatDb(db: number, digits = 1): string {
  if (db === -Infinity || db <= FLOOR_DB) return '−∞ dB';
  const v = Number(db.toFixed(digits));
  if (v === 0) return `${(0).toFixed(digits)} dB`;
  return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)} dB`;
}

/** Screen-reader text for a fader value (`aria-valuetext`). */
export function dbValueText(db: number): string {
  return db === -Infinity || db <= FLOOR_DB ? 'silent' : formatDb(db);
}

export function clampDb(db: number): number {
  if (Number.isNaN(db)) return 0;
  return Math.min(FADER_MAX_DB, db <= FLOOR_DB ? -Infinity : db);
}
