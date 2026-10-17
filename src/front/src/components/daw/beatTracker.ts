/**
 * Beat tracker (pure TS, no deps, runs in a Web Worker or inline).
 *
 * Pipeline (after Ellis 2007, "Beat Tracking by Dynamic Programming", as popularised by librosa):
 *  1. Decimate to ~11 kHz (box filter), normalise loudness.
 *  2. Onset strength = log-magnitude spectral flux (Hann STFT, 46 ms window, ~11.6 ms hop), with a
 *     separate low-band (< 160 Hz) flux used for the downbeat heuristic. Detrended, then normalised by
 *     a LOCAL level (floored) so a quiet intro keeps its onsets, then by the global std.
 *  3. Global tempo = vote of per-region tempi (10 s windows, weighted by how periodic each is) plus the
 *     whole-song autocorrelation, each under a log-normal prior around 120 BPM (minBpm..maxBpm). A song
 *     whose drums start late is therefore judged by the part that has a beat, not the whole file.
 *  4. Local tempo = windowed autocorrelation (8 s window, 1 s hop) restricted to ±30 % of the global
 *     period (no octave jumps), median-smoothed. This lets the DP follow drifting, live-played tempo.
 *  5. Dynamic programming: score(t) = onset(t) + max_τ [score(τ) − α·log²((t−τ)/P(t))], backtracked
 *     from the last strong beat, weak leading/trailing beats trimmed, each beat refined to the local
 *     onset peak (sub-frame, parabolic). The grid is then extended back to t = 0 from the first confident
 *     beat at the fitted period (`leadInBeats`), instead of starting where the drums come in.
 *  6. Downbeat phase = the beat phase (mod beatsPerBar) with the strongest low-band accents.
 */

export interface BeatTrackOptions {
  minBpm?: number;
  maxBpm?: number;
  /** Centre of the log-normal tempo prior. */
  priorBpm?: number;
  /** Used for the downbeat estimate only. */
  beatsPerBar?: number;
  onProgress?: (fraction: number) => void;
}

export interface BeatTrackResult {
  /** Beat times in seconds, strictly increasing. */
  beats: number[];
  /** Median tempo over the map. */
  bpm: number;
  /** 0..1: how periodic/beat-like the material is (low for noise or rubato). */
  confidence: number;
  /** Index into `beats` of a beat estimated to be beat 1 of a bar (0..beatsPerBar−1). */
  downbeatIndex: number;
  /** Per-beat accent strength (low-band weighted), for re-estimating the downbeat. */
  accents: number[];
  /** Leading beats that were extrapolated back from the first confident beat (no onset evidence). */
  leadInBeats: number;
}

const TARGET_RATE = 11025;
const LOW_BAND_HZ = 160;
const TIGHTNESS = 100;
const LOCAL_WINDOW_SEC = 8;
const LOCAL_HOP_SEC = 1;
const LOCAL_BAND = 1.45;
/** Region tempo voting. */
const REGION_WINDOW_SEC = 10;
const REGION_HOP_SEC = 2.5;
/** Windows quieter than this (mean squared normalised flux; ~1 on average) carry no beat evidence. */
const REGION_MIN_ENERGY = 0.05;
/** Onset-level normalisation: ~4 s local RMS, never boosting more than 1/LOCAL_FLOOR× the global RMS. */
const LOCAL_NORM_SEC = 4;
const LOCAL_FLOOR = 0.12;
/** Beats used to fit the period for the extrapolated lead-in. */
const LEAD_IN_FIT_BEATS = 32;
const MIN_SECONDS = 3;
/** Spectral flux peaks slightly before the perceived onset; measured on synthetic clicks/drums. */
const LATENCY_SEC = 0.008;

const EMPTY: BeatTrackResult = { beats: [], bpm: 0, confidence: 0, downbeatIndex: 0, accents: [], leadInBeats: 0 };

// ── Small DSP helpers ─────────────────────────────────────────────────────────

/** Box-filter decimation to roughly `targetRate` (crude anti-alias; fine for onset detection). */
export function decimate(samples: Float32Array, sampleRate: number, targetRate = TARGET_RATE): { data: Float32Array; rate: number } {
  const d = Math.max(1, Math.floor(sampleRate / targetRate));
  if (d === 1) return { data: samples, rate: sampleRate };
  const n = Math.floor(samples.length / d);
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    let s = 0;
    for (let q = 0; q < d; q++) s += samples[j++];
    out[i] = s / d;
  }
  return { data: out, rate: sampleRate / d };
}

/** In-place iterative radix-2 complex FFT (n must be a power of two). */
class Fft {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    this.n = n;
    const bits = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  transform(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

function median(values: ArrayLike<number>): number {
  const a = Array.from(values).sort((x, y) => x - y);
  if (a.length === 0) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Parabolic peak interpolation; returns the fractional offset in [-0.5, 0.5] from the centre sample. */
function parabolic(a: number, b: number, c: number): number {
  const den = a - 2 * b + c;
  if (den >= 0 || !Number.isFinite(den)) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
}

function movingAverage(x: Float64Array, width: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  const half = Math.max(1, Math.floor(width / 2));
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const wantLo = Math.max(0, i - half);
    const wantHi = Math.min(n - 1, i + half);
    while (hi < wantHi) sum += x[++hi];
    while (lo < wantLo) sum -= x[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

function stdNormalise(x: Float64Array): boolean {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length || 1;
  let v2 = 0;
  for (const v of x) v2 += (v - mean) * (v - mean);
  const std = Math.sqrt(v2 / (x.length || 1));
  if (!(std > 1e-9)) return false;
  for (let i = 0; i < x.length; i++) x[i] /= std;
  return true;
}

/**
 * Divide by the local RMS (floored relative to the global RMS) so quiet passages keep their onsets
 * instead of being flattened by the loud ones. Silence stays silent: the floor caps the boost.
 */
function localNormalise(x: Float64Array, fps: number): boolean {
  const n = x.length;
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i] * x[i];
  const g = Math.sqrt(e / (n || 1));
  if (!(g > 1e-9)) return false;
  const sq = new Float64Array(n);
  for (let i = 0; i < n; i++) sq[i] = x[i] * x[i];
  const local = movingAverage(sq, Math.round(LOCAL_NORM_SEC * fps));
  for (let i = 0; i < n; i++) x[i] /= Math.max(Math.sqrt(local[i]), LOCAL_FLOOR * g);
  return true;
}

// ── Onset envelope ────────────────────────────────────────────────────────────

interface Onsets {
  /** Detrended, std-normalised full-band spectral flux. */
  env: Float64Array;
  /** Std-normalised low-band flux (kick/bass accents). */
  low: Float64Array;
  /** Frames per second. */
  fps: number;
  /** Seconds per frame. */
  hopSec: number;
}

function onsetEnvelope(x: Float32Array, rate: number, progress: (f: number) => void): Onsets | null {
  let e2 = 0;
  for (let i = 0; i < x.length; i++) e2 += x[i] * x[i];
  const rms = Math.sqrt(e2 / (x.length || 1));
  if (!(rms > 1e-5)) return null;

  const N = 1 << Math.ceil(Math.log2(Math.max(64, rate * 0.046)));
  const H = N >> 2;
  const bins = N >> 1;
  const lowBins = Math.max(2, Math.min(bins, Math.round((LOW_BAND_HZ * N) / rate)));
  const frames = Math.floor(x.length / H) + 1;
  const fft = new Fft(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  const env = new Float64Array(frames);
  const low = new Float64Array(frames);
  const scale = 1 / rms;
  const report = Math.max(1, Math.floor(frames / 40));

  for (let f = 0; f < frames; f++) {
    // Frame f is centred on sample f·H (zero-padded at the edges).
    const start = f * H - (N >> 1);
    for (let i = 0; i < N; i++) {
      const s = start + i;
      re[i] = s >= 0 && s < x.length ? x[s] * scale * win[i] : 0;
      im[i] = 0;
    }
    fft.transform(re, im);
    let flux = 0;
    let lflux = 0;
    for (let k = 1; k <= bins - 1; k++) {
      const m = Math.log1p(Math.hypot(re[k], im[k]));
      cur[k] = m;
      if (f > 0) {
        const d = m - prev[k];
        if (d > 0) {
          flux += d;
          if (k < lowBins) lflux += d;
        }
      }
    }
    env[f] = flux;
    low[f] = lflux;
    const t = prev;
    prev = cur;
    cur = t;
    if (f % report === 0) progress((0.7 * f) / frames);
  }

  const fps = rate / H;
  // Detrend with a ~1 s moving average, half-wave rectify, std-normalise.
  const trend = movingAverage(env, Math.round(fps));
  for (let i = 0; i < frames; i++) env[i] = Math.max(0, env[i] - trend[i]);
  if (!localNormalise(env, fps) || !stdNormalise(env)) return null;
  const lowTrend = movingAverage(low, Math.round(fps));
  for (let i = 0; i < frames; i++) low[i] = Math.max(0, low[i] - lowTrend[i]);
  stdNormalise(low);
  return { env, low, fps, hopSec: H / rate };
}

// ── Tempo ─────────────────────────────────────────────────────────────────────

function autocorr(x: Float64Array, from: number, to: number, maxLag: number): Float64Array {
  const len = to - from;
  let mean = 0;
  for (let i = from; i < to; i++) mean += x[i];
  mean /= len || 1;
  const ac = new Float64Array(maxLag + 1);
  for (let l = 0; l <= maxLag && l < len; l++) {
    let s = 0;
    for (let i = from; i + l < to; i++) s += (x[i] - mean) * (x[i + l] - mean);
    ac[l] = s / (len - l);
  }
  return ac;
}

interface LagPick {
  /** Best lag (frames), parabolically refined. */
  lag: number;
  /** ac[lag] / ac[0]: how periodic the segment is (≈ 0.1 noise … 0.7–1 steady beats). */
  strength: number;
}

/** Best tempo lag in an autocorrelation under the log-normal tempo prior (slightly favouring a lag whose double is also strong). */
function pickLag(ac: Float64Array, fps: number, lo: number, hi: number, priorBpm: number): LagPick | null {
  if (!(ac[0] > 0)) return null;
  let best = lo;
  let bestScore = -Infinity;
  for (let l = lo; l <= hi && l < ac.length; l++) {
    const bpm = (fps * 60) / l;
    const w = Math.exp(-0.5 * (Math.log2(bpm / priorBpm) / 0.7) ** 2);
    const twice = 2 * l < ac.length ? ac[2 * l] : 0;
    const s = w * (ac[l] + 0.3 * Math.max(0, twice));
    if (s > bestScore) {
      bestScore = s;
      best = l;
    }
  }
  const lag = best > lo && best < hi && best + 1 < ac.length ? best + parabolic(ac[best - 1], ac[best], ac[best + 1]) : best;
  return { lag, strength: Math.max(0, ac[best] / ac[0]) };
}

/**
 * Global beat period. Tempo is voted on by overlapping 10 s regions (each weighted by its periodicity)
 * together with the whole-song autocorrelation, so an intro or breakdown without a pulse can't blur it.
 * `regionPeriodicity` is the periodicity of the best half of the regions that agree with the winner.
 */
function estimateTempo(
  env: Float64Array,
  fps: number,
  minBpm: number,
  maxBpm: number,
  priorBpm: number,
): { period: number; periodicity: number; regionPeriodicity: number } {
  const fallback = { period: (fps * 60) / priorBpm, periodicity: 0, regionPeriodicity: 0 };
  const lo = Math.max(1, Math.floor((fps * 60) / maxBpm));
  const hi = Math.ceil((fps * 60) / minBpm);
  const maxLag = Math.min(env.length - 1, 2 * hi + 2);
  const whole = pickLag(autocorr(env, 0, env.length, maxLag), fps, lo, hi, priorBpm);
  if (!whole) return fallback;

  const voters: LagPick[] = [whole];
  const regions: LagPick[] = [];
  const W = Math.round(REGION_WINDOW_SEC * fps);
  const hop = Math.max(1, Math.round(REGION_HOP_SEC * fps));
  for (let s = 0; s + W <= env.length; s += hop) {
    let energy = 0;
    for (let i = s; i < s + W; i++) energy += env[i] * env[i];
    if (energy / W < REGION_MIN_ENERGY) continue;
    const pick = pickLag(autocorr(env, s, s + W, Math.min(W - 1, maxLag)), fps, lo, hi, priorBpm);
    if (pick) {
      voters.push(pick);
      regions.push(pick);
    }
  }

  // Each voter supports every candidate lag within ~3 %; the best-supported candidate wins.
  const support = (cand: number, tol: number) =>
    voters.reduce((acc, v) => {
      const d = Math.log(v.lag / cand);
      return acc + v.strength * Math.exp(-0.5 * (d / tol) ** 2);
    }, 0);
  let winner = whole.lag;
  let winnerSupport = -Infinity;
  for (const v of voters) {
    const sup = support(v.lag, 0.03);
    if (sup > winnerSupport) {
      winnerSupport = sup;
      winner = v.lag;
    }
  }
  // Refine: strength-weighted mean of the voters that agree (within 5 %).
  let num = 0;
  let den = 0;
  for (const v of voters) {
    if (Math.abs(Math.log(v.lag / winner)) < 0.05) {
      num += v.strength * v.lag;
      den += v.strength;
    }
  }
  const period = den > 0 ? num / den : winner;

  let regionPeriodicity = whole.strength;
  if (regions.length > 0) {
    const agreeing = regions
      .map((r) => (Math.abs(Math.log(r.lag / period)) < 0.06 ? r.strength : 0))
      .sort((a, b) => b - a);
    const top = agreeing.slice(0, Math.ceil(agreeing.length / 2));
    regionPeriodicity = top.reduce((a, b) => a + b, 0) / top.length;
  }
  return { period, periodicity: whole.strength, regionPeriodicity };
}

/** Per-frame beat period (frames), following slow tempo drift around the global period. */
function localPeriods(env: Float64Array, fps: number, period: number): { per: Float64Array; periodicity: number } {
  const n = env.length;
  const per = new Float64Array(n).fill(period);
  const W = Math.round(LOCAL_WINDOW_SEC * fps);
  const hop = Math.max(1, Math.round(LOCAL_HOP_SEC * fps));
  if (n < W + hop) {
    return { per, periodicity: NaN };
  }
  const lo = Math.max(2, Math.floor(period / LOCAL_BAND));
  const hi = Math.ceil(period * LOCAL_BAND);
  const centres: number[] = [];
  const values: number[] = [];
  const strengths: number[] = [];
  for (let s = 0; s + W <= n; s += hop) {
    const ac = autocorr(env, s, s + W, hi + 1);
    let best = -1;
    let bestScore = -Infinity;
    for (let l = lo; l <= hi; l++) {
      // Mild preference for the global period keeps neighbouring windows consistent.
      const w = Math.exp(-0.5 * (Math.log2(l / period) / 0.45) ** 2);
      const sc = ac[l] * w;
      if (sc > bestScore) {
        bestScore = sc;
        best = l;
      }
    }
    centres.push(s + W / 2);
    if (best > lo && best < hi && ac[best] > 0 && ac[0] > 0) {
      values.push(best + parabolic(ac[best - 1], ac[best], ac[best + 1]));
      strengths.push(ac[best] / ac[0]);
    } else {
      values.push(NaN);
      strengths.push(0);
    }
  }
  // Fill gaps from the nearest valid window (global period if none), then a 5-point median.
  const valid = values.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  const filled = values.map((v, i) => {
    if (Number.isFinite(v)) return v;
    if (valid.length === 0) return period;
    const nearest = valid.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a));
    return values[nearest];
  });
  const smooth = filled.map((_, i) => median(filled.slice(Math.max(0, i - 2), i + 3)));
  // Linear interpolation between window centres.
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i <= centres[0]) per[i] = smooth[0];
    else if (i >= centres[centres.length - 1]) per[i] = smooth[smooth.length - 1];
    else {
      while (centres[j + 1] < i) j++;
      const f = (i - centres[j]) / (centres[j + 1] - centres[j]);
      per[i] = smooth[j] + f * (smooth[j + 1] - smooth[j]);
    }
  }
  const periodicity = strengths.reduce((a, b) => a + b, 0) / (strengths.length || 1);
  return { per, periodicity };
}

// ── Dynamic programming ───────────────────────────────────────────────────────

function gaussianSmooth(x: Float64Array, sigma: number): Float64Array {
  if (sigma < 0.5) return Float64Array.from(x);
  const r = Math.ceil(3 * sigma);
  const k = new Float64Array(2 * r + 1);
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp(-0.5 * (i / sigma) ** 2);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) {
      const q = i + j;
      if (q >= 0 && q < x.length) s += x[q] * k[j + r];
    }
    out[i] = s;
  }
  return out;
}

function lastBeat(cum: Float64Array): number {
  const maxima: number[] = [];
  for (let i = 1; i < cum.length - 1; i++) {
    if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxima.push(i);
  }
  if (maxima.length === 0) return cum.length - 1;
  const thr = 0.5 * median(maxima.map((i) => cum[i]));
  for (let m = maxima.length - 1; m >= 0; m--) if (cum[maxima[m]] >= thr) return maxima[m];
  return maxima[maxima.length - 1];
}

function trackDp(score: Float64Array, per: Float64Array): number[] {
  const n = score.length;
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const p = per[i];
    const lo = Math.max(0, i - Math.round(2 * p));
    const hi = i - Math.max(1, Math.round(p / 2));
    let best = -Infinity;
    let arg = -1;
    for (let t = lo; t <= hi; t++) {
      const lr = Math.log((i - t) / p);
      const v = cum[t] - TIGHTNESS * lr * lr;
      if (v > best) {
        best = v;
        arg = t;
      }
    }
    cum[i] = score[i] + (arg >= 0 ? best : 0);
    back[i] = arg;
  }
  const beats: number[] = [];
  for (let b = lastBeat(cum); b >= 0; b = back[b]) beats.push(b);
  beats.reverse();
  // Trim weak leading/trailing beats (the DP happily extends the chain through silence).
  if (beats.length > 0) {
    const thr = 0.5 * Math.sqrt(beats.reduce((s, b) => s + score[b] * score[b], 0) / beats.length);
    let a = 0;
    let z = beats.length;
    while (a < z && score[beats[a]] <= thr) a++;
    while (z > a && score[beats[z - 1]] <= thr) z--;
    return beats.slice(a, z);
  }
  return beats;
}

/**
 * Times (ascending, ≥ 0) of beats before `beats[0]`, spaced by the least-squares period of the first
 * beats (far more accurate than one interval: the error would otherwise accumulate over a long intro).
 */
function leadInBeats(beats: number[]): number[] {
  const n = Math.min(beats.length, LEAD_IN_FIT_BEATS);
  if (n < 4) return [];
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += beats[i];
    sxy += i * beats[i];
    sxx += i * i;
  }
  const period = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  if (!(period > 0.2 && period < 2)) return [];
  const out: number[] = [];
  for (let t = beats[0] - period; t >= 0; t -= period) out.push(t);
  return out.reverse();
}

/** Index (0..beatsPerBar−1) of the beat phase with the strongest mean accent. */
export function estimateDownbeat(accents: number[], beatsPerBar: number): number {
  const B = Math.max(1, Math.round(beatsPerBar));
  if (B === 1 || accents.length < B) return 0;
  let best = 0;
  let bestScore = -Infinity;
  for (let p = 0; p < B; p++) {
    let s = 0;
    let c = 0;
    for (let i = p; i < accents.length; i += B) {
      s += accents[i];
      c++;
    }
    const m = c ? s / c : 0;
    if (m > bestScore + 1e-12) {
      bestScore = m;
      best = p;
    }
  }
  return best;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Track beats in a mono signal. Synchronous and CPU-bound (≈ 0.3–1 s for a 5 min song): run it in a
 * worker (see `beatTracker.worker.ts`). Returns an empty map with confidence 0 for silence or
 * clips shorter than 3 s.
 */
export function trackBeats(samples: Float32Array, sampleRate: number, opts: BeatTrackOptions = {}): BeatTrackResult {
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 200;
  const priorBpm = opts.priorBpm ?? 120;
  const beatsPerBar = opts.beatsPerBar ?? 4;
  let last = -1;
  const progress = (f: number) => {
    if (!opts.onProgress) return;
    const r = Math.round(f * 100) / 100;
    if (r !== last) {
      last = r;
      opts.onProgress(r);
    }
  };

  if (samples.length < sampleRate * MIN_SECONDS) return { ...EMPTY };
  const { data, rate } = decimate(samples, sampleRate);
  const onsets = onsetEnvelope(data, rate, progress);
  if (!onsets) {
    progress(1);
    return { ...EMPTY };
  }
  const { env, low, fps, hopSec } = onsets;

  const { period, periodicity: globalPeriodicity, regionPeriodicity } = estimateTempo(env, fps, minBpm, maxBpm, priorBpm);
  progress(0.75);
  const { per, periodicity: localPeriodicity } = localPeriods(env, fps, period);
  progress(0.85);

  const score = gaussianSmooth(env, period / 32);
  const frames = trackDp(score, per);
  progress(0.95);
  if (frames.length < 2) {
    progress(1);
    return { ...EMPTY };
  }

  // Sub-frame refinement to the nearest onset peak (±2 frames), only where there is a real onset.
  const beats: number[] = [];
  const accents: number[] = [];
  for (const b of frames) {
    let m = b;
    for (let q = Math.max(1, b - 2); q <= Math.min(env.length - 2, b + 2); q++) if (env[q] > env[m]) m = q;
    let f = b;
    if (env[m] > 0.5 && m > 0 && m < env.length - 1) f = m + parabolic(env[m - 1], env[m], env[m + 1]);
    const t = f * hopSec + LATENCY_SEC;
    if (beats.length === 0 || t > beats[beats.length - 1] + 1e-3) {
      beats.push(Math.max(0, t));
      let a = 0;
      for (let q = Math.max(0, m - 1); q <= Math.min(low.length - 1, m + 1); q++) a = Math.max(a, low[q]);
      accents.push(a + 0.25 * env[m]);
    }
  }

  // Confidence: beat/off-beat onset contrast blended with how periodic the envelope is.
  let onBeat = 0;
  let offBeat = 0;
  for (let i = 0; i + 1 < frames.length; i++) {
    onBeat += score[frames[i]];
    offBeat += score[Math.round((frames[i] + frames[i + 1]) / 2)];
  }
  const contrast = Math.max(0, (onBeat - offBeat) / (onBeat + offBeat + 1e-9));
  const periodicity = Math.max(globalPeriodicity, regionPeriodicity, Number.isFinite(localPeriodicity) ? localPeriodicity : 0);
  // Periodicity (noise ≈ 0.1, random hits ≈ 0.15, steady beats 0.7–1) dominates; contrast is biased upward on noise.
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const confidence = 0.8 * clamp01((periodicity - 0.08) / 0.42) + 0.2 * clamp01(contrast);

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
  const bpm = 60 / median(intervals);
  const downbeat = estimateDownbeat(accents, beatsPerBar);

  // Extend the grid back to t = 0 from the first confident beat, at the period fitted over its first
  // beats. A drum entry late in the song then doesn't leave the intro without a grid.
  const lead = leadInBeats(beats);
  const B = Math.max(1, Math.round(beatsPerBar));
  progress(1);
  return {
    beats: [...lead, ...beats],
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    downbeatIndex: (downbeat + lead.length) % B,
    accents: [...new Array<number>(lead.length).fill(0), ...accents],
    leadInBeats: lead.length,
  };
}

/**
 * Mono mix (and box-decimation to ~11 kHz) of planar channel data. Async + chunked so a long,
 * many-stem session doesn't freeze the UI while it's prepared for the worker.
 */
export async function mixToMono(
  sources: { channels: Float32Array[]; sampleRate: number }[],
  targetRate = TARGET_RATE,
): Promise<{ data: Float32Array; rate: number }> {
  if (sources.length === 0) return { data: new Float32Array(0), rate: targetRate };
  const sr = sources[0].sampleRate;
  const d = Math.max(1, Math.floor(sr / targetRate));
  const frames = Math.max(...sources.map((s) => (s.channels[0]?.length ?? 0)));
  const n = Math.floor(frames / d);
  const out = new Float32Array(n);
  const CHUNK = 1 << 18;
  for (const src of sources) {
    if (src.sampleRate !== sr || src.channels.length === 0) continue;
    const scale = 1 / (src.channels.length * sources.length * d);
    for (const ch of src.channels) {
      for (let i0 = 0; i0 < n; i0 += CHUNK) {
        const i1 = Math.min(n, i0 + CHUNK);
        for (let i = i0; i < i1; i++) {
          let s = 0;
          const base = i * d;
          for (let q = 0; q < d && base + q < ch.length; q++) s += ch[base + q];
          out[i] += s * scale;
        }
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }
  }
  return { data: out, rate: sr / d };
}
