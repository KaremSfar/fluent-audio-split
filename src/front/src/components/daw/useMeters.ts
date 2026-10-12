import { useCallback, useEffect, useState } from 'react';
import { MASTER_ANALYSER, type StemSyncEngine } from '@/components/execution/stemSyncEngine';
import { prefersReducedMotion } from './useTransportPos';

interface MeterTarget {
  bar: HTMLElement;
  hold: HTMLElement | null;
  level: number;
  holdLevel: number;
  holdAt: number;
}

const FLOOR_DB = -60;
const HOLD_MS = 1500;
const FALL_PER_SEC = 1.5;
const REDUCED_INTERVAL_MS = 100;

/**
 * One shared requestAnimationFrame loop that reads every registered analyser and writes the bars
 * straight to the DOM (a `transform`), so metering never re-renders React.
 */
export class MeterBus {
  private readonly targets = new Map<string, MeterTarget>();
  private readonly buf = new Float32Array(1024);
  private raf = 0;
  private last = 0;
  private lastPaint = 0;
  private readonly reduced = prefersReducedMotion();
  private onMasterClip: (() => void) | null = null;

  setClipHandler(cb: (() => void) | null): void {
    this.onMasterClip = cb;
  }

  private readonly engine: StemSyncEngine;

  constructor(engine: StemSyncEngine) {
    this.engine = engine;
  }

  register(id: string, bar: HTMLElement, hold: HTMLElement | null): () => void {
    this.targets.set(id, { bar, hold, level: 0, holdLevel: 0, holdAt: 0 });
    return () => {
      this.targets.delete(id);
    };
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      this.paint(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const t of this.targets.values()) {
      t.level = 0;
      t.holdLevel = 0;
      this.write(t);
    }
  }

  private paint(now: number): void {
    if (this.reduced && now - this.lastPaint < REDUCED_INTERVAL_MS) return;
    this.lastPaint = now;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    for (const [id, t] of this.targets) {
      const analyser = this.engine.getAnalyser(id);
      let peak = 0;
      if (analyser) {
        analyser.getFloatTimeDomainData(this.buf);
        for (let i = 0; i < this.buf.length; i++) {
          const v = Math.abs(this.buf[i]);
          if (v > peak) peak = v;
        }
      }
      if (id === MASTER_ANALYSER && peak >= 1) this.onMasterClip?.();
      const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
      const level = Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
      t.level = this.reduced ? level : Math.max(level, t.level - FALL_PER_SEC * dt);
      if (level >= t.holdLevel || now - t.holdAt > HOLD_MS) {
        t.holdLevel = level;
        t.holdAt = now;
      }
      this.write(t);
    }
  }

  private write(t: MeterTarget): void {
    t.bar.style.transform = `scaleX(${1 - t.level})`;
    if (t.hold) t.hold.style.left = `${t.holdLevel * 100}%`;
  }
}

/** Creates the page's meter bus, runs it only while playing, and tracks the latching master clip LED. */
export function useMeters(engine: StemSyncEngine, playing: boolean) {
  const [bus] = useState(() => new MeterBus(engine));
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    bus.setClipHandler(() => setClipped(true));
    return () => {
      bus.setClipHandler(null);
      bus.stop();
    };
  }, [bus]);

  useEffect(() => {
    if (playing) bus.start();
    else bus.stop();
  }, [bus, playing]);

  const resetClip = useCallback(() => setClipped(false), []);
  return { bus, clipped, resetClip };
}
