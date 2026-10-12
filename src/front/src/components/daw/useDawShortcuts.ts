import { useEffect, useRef } from 'react';

export interface DawShortcutHandlers {
  playPause: () => void;
  toStart: () => void;
  /** Seek relative; `unit` is seconds, or `'bar'` for a one-bar step. */
  seekBy: (direction: -1 | 1, unit: 'bar' | 'sec', shift: boolean) => void;
  toggleClick: () => void;
  tap: () => void;
  setDownbeat: () => void;
  nudge: (deltaSec: number) => void;
  /** Drop a beat anchor at the playhead (`downbeat`: it is also beat 1). */
  anchor: (downbeat: boolean) => void;
  /** L: loop the bar at the playhead / turn the loop off. Shift+L: loop 4 bars. */
  loop: (fourBars: boolean) => void;
  toggleGap: () => void;
  togglePractice: () => void;
  focusTrack: (n: number) => void;
  muteFocused: () => void;
  soloFocused: (exclusive: boolean) => void;
  clearSolos: () => void;
  volumeFocused: (deltaDb: number) => void;
  resetFocused: () => void;
  help: () => void;
}

function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return el.type !== 'range' && el.type !== 'checkbox' && el.type !== 'button';
  return false;
}

/** Results-page keyboard shortcuts (design §1.7). Ignored while typing in a field. */
export function useDawShortcuts(handlers: DawShortcutHandlers, enabled = true): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || isTextField(e.target)) return;
      const h = ref.current;
      const target = e.target as HTMLElement | null;
      const onRange = target instanceof HTMLInputElement && target.type === 'range';
      const onControl = !!target?.closest('button, a, select, summary, [role="menuitem"], dialog, [role="dialog"]');

      // Arrow/Home/End belong to a focused slider (native or our dB stepping).
      if (onRange && /^(Arrow|Home$|End$|Page)/.test(e.key)) return;

      switch (e.key) {
        case ' ':
          if (onControl) return;
          e.preventDefault();
          return h.playPause();
        case 'Enter':
          if (onControl) return;
          e.preventDefault();
          return h.toStart();
        case 'Home':
          e.preventDefault();
          return h.toStart();
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          return h.seekBy(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 'bar' : 'sec', e.shiftKey);
        }
        case 'ArrowUp':
        case 'ArrowDown':
          e.preventDefault();
          return h.volumeFocused((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.5));
        case '[':
          return h.nudge(-0.01);
        case ']':
          return h.nudge(0.01);
        case '?':
          return h.help();
      }

      if (e.altKey && e.code !== 'KeyS') return;
      switch (e.code) {
        case 'KeyC':
          return h.toggleClick();
        case 'KeyT':
          return h.tap();
        case 'KeyD':
          return h.setDownbeat();
        case 'KeyA':
          return h.anchor(e.shiftKey);
        case 'KeyL':
          return h.loop(e.shiftKey);
        case 'KeyG':
          return h.toggleGap();
        case 'KeyP':
          return h.togglePractice();
        case 'KeyM':
          return h.muteFocused();
        case 'KeyS':
          if (e.shiftKey) return h.clearSolos();
          return h.soloFocused(e.altKey);
        case 'Digit0':
          return h.resetFocused();
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) h.focusTrack(Number(digit[1]));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
