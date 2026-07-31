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

interface StemEntry {
  path: string;
  visual: StemVisual;
  blobUrl: string | null;
  buffer: AudioBuffer | null;
  gain: GainNode | null;
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
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
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
    entry.gain?.disconnect();
    if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    this.entries.delete(id);
    if (wasActive) this.freezeIfIdle();
  }

  /** Subscribe to natural end-of-song (transport reached the end and rewound). Returns an unsubscribe. */
  onTransportEnded(cb: () => void): () => void {
    this.endListeners.add(cb);
    return () => this.endListeners.delete(cb);
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
      gain.connect(ctx.destination);
      entry.gain = gain;
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
  private nowPos(): number {
    if (!this.running || !this.ctx) return this.pausedPos;
    return this.originPos + (this.ctx.currentTime - this.originCtxTime);
  }

  private clampPos(t: number): number {
    if (this.duration <= 0) return Math.max(0, t);
    return Math.max(0, Math.min(t, this.duration));
  }

  // ── Playback ──────────────────────────────────────────────────────────────────
  /**
   * Activate the given stems and start them on the shared clock. Stems must already be loaded
   * (via `prepare`). If the transport is stopped, this (re)starts it from the frozen position; if
   * another node is already playing, these stems join it in exact phase.
   */
  play(ids: string[]): void {
    const ctx = this.ensureContext();
    const entries = ids
      .map((id) => this.entries.get(id))
      .filter((e): e is StemEntry => !!e && !!e.buffer && !!e.gain);
    if (entries.length === 0) return;

    if (!this.running) {
      this.originPos = this.clampPos(this.pausedPos);
      this.originCtxTime = ctx.currentTime + LOOKAHEAD;
      this.running = true;
    }

    const startAt = Math.max(ctx.currentTime + LOOKAHEAD, this.originCtxTime);
    for (const entry of entries) {
      entry.active = true;
      // Buffer offset that lands this source exactly on the transport at `startAt`.
      const offset = this.originPos + (startAt - this.originCtxTime);
      this.startSource(entry, startAt, offset);
    }
    this.startRaf();
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
      for (const entry of this.entries.values()) {
        if (entry.active && entry.buffer && entry.gain) this.startSource(entry, startAt, t);
      }
    } else {
      this.pausedPos = t;
    }
    for (const entry of this.entries.values()) entry.visual.setCursor(t);
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
      entry.gain?.disconnect();
      if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
      entry.blobUrl = null;
      entry.buffer = null;
      entry.gain = null;
      entry.loadPromise = null;
      entry.active = false;
    }
    this.running = false;
    this.pausedPos = 0;
    this.duration = 0;
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
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
    const clampedOffset = Math.max(0, Math.min(offset, entry.buffer.duration));
    source.start(startAt, clampedOffset);
    entry.source = source;
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
      this.pausedPos = this.clampPos(posBefore ?? this.nowPos());
      this.running = false;
      this.stopRaf();
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
      for (const entry of this.entries.values()) {
        if (entry.active) entry.visual.setCursor(pos);
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
    for (const cb of [...this.endListeners]) cb();
  }
}
