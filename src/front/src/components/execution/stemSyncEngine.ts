import { filesService } from '@/services/filesService';

/**
 * View hooks a single stem's waveform registers with the engine. The engine owns all audio and the
 * transport clock; the waveform is a passive, muted visualizer whose cursor the engine drives.
 */
export interface StemVisual {
  /** Create the (muted, never-played) wavesurfer for this stem from the given in-memory blob URL. */
  renderWaveform: (blobUrl: string) => Promise<void>;
  /** Move this stem's visual cursor to the given transport position (seconds). */
  setCursor: (time: number) => void;
  /** Surface a load/decode failure to the view. */
  setError: (error: boolean) => void;
}

/** Snapshot of the shared transport anchor (see {@link StemSyncEngine.getTransport}). */
export interface TransportSnapshot {
  running: boolean;
  /** `ctx.currentTime` at the last (re)anchor. */
  originCtxTime: number;
  /** Transport position (seconds) at `originCtxTime`. */
  originPos: number;
  /** Frozen position while stopped. */
  pausedPos: number;
  duration: number;
  /**
   * Loop engaged for the current anchor (null/absent = linear). While engaged, transport position
   * wraps: raw = originPos + (ctxTime − originCtxTime); pos = raw < end ? raw : start + (raw − start) mod (end − start).
   */
  loop?: LoopRegion | null;
}

/** A–B loop region in transport seconds (`end` exclusive). */
export interface LoopRegion {
  start: number;
  end: number;
}

/** Shortest loop the engine accepts (s). */
export const MIN_LOOP_SEC = 0.05;

/** Wrap a raw (unwrapped) transport position into a loop (see {@link TransportSnapshot.loop}). */
export function wrapLoopPos(raw: number, loop: LoopRegion | null | undefined): number {
  if (!loop || raw < loop.end) return raw;
  const len = loop.end - loop.start;
  return loop.start + ((raw - loop.start) % len);
}

export type TransportChange = 'play' | 'pause' | 'seek' | 'end';

/** Key for {@link StemSyncEngine.getAnalyser} that returns the post-master analyser. */
export const MASTER_ANALYSER = 'master';

interface StemEntry {
  path: string;
  visual: StemVisual;
  blobUrl: string | null;
  buffer: AudioBuffer | null;
  /** Mute/solo gate (0 or 1, ramped). Kept separate from the fader so muting never loses the volume. */
  gain: GainNode | null;
  /** Per-stem volume fader (linear), downstream of the gate. */
  fader: GainNode | null;
  /** Post-fader analyser for metering. */
  analyser: AnalyserNode | null;
  /** Linear fader value, remembered so it applies when the nodes are created. */
  volume: number;
  /** The single one-shot source currently scheduled/playing for this stem (or null). */
  source: AudioBufferSourceNode | null;
  muted: boolean;
  /** True while this stem's node wants it sounding (its master transport is playing). */
  active: boolean;
  loadPromise: Promise<void> | null;
}

// Schedule every source start a hair in the future so all sources begin exactly together on the
// same clock tick instead of "starting in the past" (which the WebAudio spec would collapse to an
// immediate, slightly-offset start). ~30 ms is inaudible and comfortably beyond scheduling jitter.
const LOOKAHEAD = 0.03;
// Ramp gain changes over a few ms so mute/solo toggles don't click.
const GAIN_RAMP = 0.008;
// Time constant for fader/master moves (setTargetAtTime).
const FADER_TIME_CONSTANT = 0.01;

/**
 * Sample-accurate, drift-free playback for every stem across every node execution on a page.
 *
 * The echo the previous per-`<audio>`-element approach couldn't beat came from each stem being its
 * own `HTMLMediaElement` with its own clock: joining an already-playing node meant reading a peer's
 * `currentTime`, then `play()`-ing after ~20-100 ms of unmeasurable latency during which the peer
 * moved on — a permanent offset. And because the stems are the *same song* separated by different
 * models, even a few ms of offset comb-filters audibly.
 *
 * Here every stem plays through one shared `AudioContext`. Playback position is a single virtual
 * transport anchored to `ctx.currentTime` (`pos = originPos + (ctx.currentTime - originCtxTime)`),
 * and each stem is an `AudioBufferSourceNode` started with `source.start(startAt, offset)` computed
 * off that one clock. Sources started from the same clock never drift and join in exact phase, so
 * there is nothing to "correct" — the whole class of drift/echo bugs is gone. wavesurfer is demoted
 * to a muted waveform whose cursor the engine nudges each animation frame.
 */
export class StemSyncEngine {
  private ctx: AudioContext | null = null;
  private readonly entries = new Map<string, StemEntry>();

  private running = false;
  /** `ctx.currentTime` at the last (re)anchor of the transport. */
  private originCtxTime = 0;
  /** Transport position (seconds into the song) at `originCtxTime`. */
  private originPos = 0;
  /** Frozen transport position while stopped (resume point). */
  private pausedPos = 0;
  /** Longest loaded stem — the transport's length, used for finish detection and clamping. */
  private duration = 0;

  private rafId: number | null = null;
  private readonly endListeners = new Set<() => void>();
  private readonly transportListeners = new Set<(kind: TransportChange, t: TransportSnapshot) => void>();

  // Master bus: every stem's fader -> master -> masterAnalyser -> destination.
  private master: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterVolume = 1;

  /** Requested A–B loop (null = off). */
  private loopRegion: LoopRegion | null = null;
  /** Whether the loop applies to the current anchor (anchor position was before the loop end). */
  private loopEngaged = false;

  // ── Context ────────────────────────────────────────────────────────────────
  /**
   * Create/resume the shared `AudioContext`. MUST be called synchronously inside a user gesture
   * (e.g. the master Play click) before any `await`, or the browser's autoplay policy keeps the
   * context suspended and nothing is audible.
   */
  ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolume;
      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 1024;
      this.master.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** The shared `AudioContext`, or null before the first `ensureContext()`/`prepare()`. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  // ── Registration (from StemWaveformPlayer mount/unmount) ─────────────────────
  register(id: string, path: string, visual: StemVisual): void {
    const existing = this.entries.get(id);
    if (existing) {
      existing.visual = visual;
      existing.path = path;
      return;
    }
    this.entries.set(id, {
      path,
      visual,
      blobUrl: null,
      buffer: null,
      gain: null,
      fader: null,
      analyser: null,
      volume: 1,
      source: null,
      muted: false,
      active: false,
      loadPromise: null,
    });
  }

  unregister(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const wasActive = entry.active;
    this.stopSource(entry);
    this.disconnectChain(entry);
    if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    this.entries.delete(id);
    if (wasActive) this.freezeIfIdle();
  }

  /** Subscribe to natural end-of-song (transport reached the end and rewound). Returns an unsubscribe. */
  onTransportEnded(cb: () => void): () => void {
    this.endListeners.add(cb);
    return () => this.endListeners.delete(cb);
  }

  /** Subscribe to every transport anchor change (play/pause/seek/end), fired after the anchor is updated. */
  onTransportChange(cb: (kind: TransportChange, t: TransportSnapshot) => void): () => void {
    this.transportListeners.add(cb);
    return () => this.transportListeners.delete(cb);
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  /** Fetch + decode every given stem (idempotent, cached) and build its waveform. */
  prepare(ids: string[]): Promise<void> {
    return Promise.all(ids.map((id) => this.prepareOne(id))).then(() => undefined);
  }

  private prepareOne(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.resolve();
    if (entry.buffer) return Promise.resolve();
    if (entry.loadPromise) return entry.loadPromise;

    const ctx = this.ensureContext();
    const promise = (async () => {
      const blobUrl = await filesService.getObjectUrl(entry.path);
      // decodeAudioData detaches its ArrayBuffer, so fetch a fresh one from the in-memory blob.
      const arrayBuffer = await (await fetch(blobUrl)).arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);

      // Bail if the stem was unregistered (unmounted) while we were fetching/decoding.
      if (this.entries.get(id) !== entry) {
        URL.revokeObjectURL(blobUrl);
        return;
      }

      entry.blobUrl = blobUrl;
      entry.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = entry.muted ? 0 : 1;
      const fader = ctx.createGain();
      fader.gain.value = entry.volume;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      gain.connect(fader);
      fader.connect(analyser);
      analyser.connect(this.master ?? ctx.destination);
      entry.gain = gain;
      entry.fader = fader;
      entry.analyser = analyser;
      if (buffer.duration > this.duration) this.duration = buffer.duration;

      await entry.visual.renderWaveform(blobUrl);
    })();

    entry.loadPromise = promise.catch((err) => {
      // Allow a later retry, and let the failed stem show its error state.
      entry.loadPromise = null;
      entry.visual.setError(true);
      throw err;
    });
    return entry.loadPromise;
  }

  // ── Transport clock ──────────────────────────────────────────────────────────
  /** Current transport position in seconds. Negative while a count-in delay is pending. */
  nowPos(): number {
    if (!this.running || !this.ctx) return this.pausedPos;
    return wrapLoopPos(this.originPos + (this.ctx.currentTime - this.originCtxTime), this.engagedLoop());
  }

  private engagedLoop(): LoopRegion | null {
    return this.loopEngaged ? this.loopRegion : null;
  }

  /** True while a count-in delay (or the start lookahead) is still pending. */
  private beforeOrigin(): boolean {
    return !!this.ctx && this.running && this.ctx.currentTime < this.originCtxTime;
  }

  private clampPos(t: number): number {
    if (this.duration <= 0) return Math.max(0, t);
    return Math.max(0, Math.min(t, this.duration));
  }

  getTransport(): TransportSnapshot {
    return {
      running: this.running,
      originCtxTime: this.originCtxTime,
      originPos: this.originPos,
      pausedPos: this.pausedPos,
      duration: this.duration,
      loop: this.engagedLoop(),
    };
  }

  getLoop(): LoopRegion | null {
    return this.loopRegion;
  }

  /**
   * Set (or clear with null) the A–B loop. Looping is seamless: every stem's source uses the native
   * `AudioBufferSourceNode` loop with identical loopStart/loopEnd, so all stems wrap on the same
   * sample. Playing from before the loop end runs into the loop and repeats it; a position after the
   * loop end plays linearly (until the next seek/play inside). While running, the transport is
   * re-anchored at the current position and live sources are retargeted in place (no restart, no gap).
   * Emits `'seek'` so followers (metronome) reschedule.
   */
  setLoop(region: LoopRegion | null): void {
    let next: LoopRegion | null = null;
    if (region && Number.isFinite(region.start) && Number.isFinite(region.end)) {
      const start = Math.max(0, region.start);
      const end = this.duration > 0 ? Math.min(region.end, this.duration) : region.end;
      if (end - start >= MIN_LOOP_SEC) next = { start, end };
    }
    if (this.running && this.ctx && !this.beforeOrigin()) {
      // Re-anchor "now" so the raw/wrapped mapping restarts cleanly under the new region.
      this.originPos = this.nowPos();
      this.originCtxTime = this.ctx.currentTime;
    }
    this.loopRegion = next;
    this.loopEngaged = !!next && this.originPos < next.end;
    if (this.running) {
      for (const entry of this.entries.values()) {
        if (entry.source && entry.buffer) this.applyLoop(entry.source, entry.buffer);
      }
    }
    this.emit('seek');
  }

  private applyLoop(source: AudioBufferSourceNode, buffer: AudioBuffer): void {
    const loop = this.engagedLoop();
    // A stem shorter than the loop end can't follow the loop; let it run out instead.
    if (loop && loop.end <= buffer.duration + 1e-3) {
      source.loopStart = loop.start;
      source.loopEnd = loop.end;
      source.loop = true;
    } else {
      source.loop = false;
    }
  }

  /** Transport time (s) -> `AudioContext` time. Only meaningful while the transport is running. */
  toCtxTime(pos: number): number {
    return this.originCtxTime + (pos - this.originPos);
  }

  /** Ids of every registered stem (loaded or not). */
  registeredIds(): string[] {
    return [...this.entries.keys()];
  }

  isLoaded(id: string): boolean {
    return !!this.entries.get(id)?.buffer;
  }

  /** Decoded audio for a loaded stem (used for BPM detection). */
  getBuffer(id: string): AudioBuffer | null {
    return this.entries.get(id)?.buffer ?? null;
  }

  /** Analyser for metering: a stem id (post-fader) or {@link MASTER_ANALYSER}. */
  getAnalyser(id: string): AnalyserNode | null {
    if (id === MASTER_ANALYSER) return this.masterAnalyser;
    return this.entries.get(id)?.analyser ?? null;
  }

  /** Per-stem fader as a linear gain (independent of mute/solo). */
  setVolume(id: string, gain: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.volume = gain;
    if (entry.fader) this.rampTo(entry.fader.gain, gain);
  }

  setMasterVolume(gain: number): void {
    this.masterVolume = gain;
    if (this.master) this.rampTo(this.master.gain, gain);
  }

  private rampTo(param: AudioParam, target: number): void {
    if (!this.ctx) {
      param.value = target;
      return;
    }
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.setTargetAtTime(target, now, FADER_TIME_CONSTANT);
  }

  private emit(kind: TransportChange): void {
    const snap = this.getTransport();
    for (const cb of [...this.transportListeners]) cb(kind, snap);
  }

  // ── Playback ──────────────────────────────────────────────────────────────────
  /**
   * Activate the given stems and start them on the shared clock. Stems must already be loaded
   * (via `prepare`). If the transport is stopped, this (re)starts it from the frozen position; if
   * another node is already playing, these stems join it in exact phase. `opts.delaySec` (only
   * honoured when starting from stopped) delays the transport origin, so `nowPos()` is negative
   * until the delay elapses — used for the metronome count-in.
   */
  play(ids: string[], opts?: { delaySec?: number }): void {
    const ctx = this.ensureContext();
    const entries = ids
      .map((id) => this.entries.get(id))
      .filter((e): e is StemEntry => !!e && !!e.buffer && !!e.gain);
    if (entries.length === 0) return;

    if (!this.running) {
      this.originPos = this.clampPos(this.pausedPos);
      this.originCtxTime = ctx.currentTime + LOOKAHEAD + Math.max(0, opts?.delaySec ?? 0);
      this.loopEngaged = !!this.loopRegion && this.originPos < this.loopRegion.end;
      this.running = true;
    }

    const startAt = Math.max(ctx.currentTime + LOOKAHEAD, this.originCtxTime);
    for (const entry of entries) {
      entry.active = true;
      // Buffer offset that lands this source exactly on the transport at `startAt` (wrapped into an engaged loop).
      const offset = wrapLoopPos(this.originPos + (startAt - this.originCtxTime), this.engagedLoop());
      this.startSource(entry, startAt, offset);
    }
    this.startRaf();
    this.emit('play');
  }

  /** Pause the given stems. The shared transport only freezes once nothing anywhere is still playing. */
  pause(ids: string[]): void {
    const posBefore = this.nowPos();
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      entry.active = false;
      this.stopSource(entry);
    }
    this.freezeIfIdle(posBefore);
  }

  /** Seek every stem (in every node) to `time`; keeps playing nodes in exact phase at the new spot. */
  seek(time: number): void {
    const t = this.clampPos(time);
    if (this.running && this.ctx) {
      const startAt = this.ctx.currentTime + LOOKAHEAD;
      this.originPos = t;
      this.originCtxTime = startAt;
      this.loopEngaged = !!this.loopRegion && t < this.loopRegion.end;
      for (const entry of this.entries.values()) {
        if (entry.active && entry.buffer && entry.gain) this.startSource(entry, startAt, t);
      }
    } else {
      this.pausedPos = t;
      this.loopEngaged = !!this.loopRegion && t < this.loopRegion.end;
    }
    for (const entry of this.entries.values()) entry.visual.setCursor(t);
    this.emit('seek');
  }

  setMuted(id: string, muted: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.muted = muted;
    if (entry.gain && this.ctx) {
      const now = this.ctx.currentTime;
      const target = muted ? 0 : 1;
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
      entry.gain.gain.linearRampToValueAtTime(target, now + GAIN_RAMP);
    }
  }

  /** Tear down all audio (page unmount). Reusable: a later `play` re-decodes and starts fresh. */
  release(): void {
    this.stopRaf();
    for (const entry of this.entries.values()) {
      this.stopSource(entry);
      this.disconnectChain(entry);
      if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
      entry.blobUrl = null;
      entry.buffer = null;
      entry.gain = null;
      entry.fader = null;
      entry.analyser = null;
      entry.loadPromise = null;
      entry.active = false;
    }
    this.running = false;
    this.pausedPos = 0;
    this.duration = 0;
    this.loopRegion = null;
    this.loopEngaged = false;
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.masterAnalyser = null;
  }

  // ── Internals ──────────────────────────────────────────────────────────────────
  private startSource(entry: StemEntry, startAt: number, offset: number): void {
    if (!this.ctx || !entry.buffer || !entry.gain) return;
    this.stopSource(entry);
    const source = this.ctx.createBufferSource();
    source.buffer = entry.buffer;
    source.connect(entry.gain);
    source.onended = () => {
      if (entry.source === source) entry.source = null;
    };
    this.applyLoop(source, entry.buffer);
    const clampedOffset = Math.max(0, Math.min(offset, entry.buffer.duration));
    source.start(startAt, clampedOffset);
    entry.source = source;
  }

  private disconnectChain(entry: StemEntry): void {
    entry.gain?.disconnect();
    entry.fader?.disconnect();
    entry.analyser?.disconnect();
  }

  private stopSource(entry: StemEntry): void {
    const source = entry.source;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped/never started — fine.
    }
    try {
      source.disconnect();
    } catch {
      // Ignore.
    }
    entry.source = null;
  }

  private freezeIfIdle(posBefore?: number): void {
    let anyActive = false;
    for (const entry of this.entries.values()) {
      if (entry.active) {
        anyActive = true;
        break;
      }
    }
    if (!anyActive && this.running) {
      // During a count-in the position is still behind the origin: resume from the origin, not before it.
      // (Compared via the clock, not the position: inside a loop the wrapped position can be < originPos.)
      this.pausedPos = this.clampPos(this.beforeOrigin() ? this.originPos : (posBefore ?? this.nowPos()));
      this.running = false;
      this.stopRaf();
      this.emit('pause');
    }
  }

  private startRaf(): void {
    if (this.rafId != null || typeof requestAnimationFrame === 'undefined') return;
    const tick = () => {
      this.rafId = null;
      if (!this.running) return;
      const pos = this.nowPos();
      if (this.duration > 0 && pos >= this.duration) {
        this.finish();
        return;
      }
      // Negative during a count-in: hold the cursor at the start.
      const cursor = Math.max(0, pos);
      for (const entry of this.entries.values()) {
        if (entry.active) entry.visual.setCursor(cursor);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRaf(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private finish(): void {
    for (const entry of this.entries.values()) {
      if (entry.active) {
        this.stopSource(entry);
        entry.active = false;
      }
      entry.visual.setCursor(0);
    }
    this.running = false;
    this.pausedPos = 0;
    this.stopRaf();
    this.emit('end');
    for (const cb of [...this.endListeners]) cb();
  }
}
