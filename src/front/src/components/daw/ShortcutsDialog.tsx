import { useEffect, useRef } from 'react';

const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Space', 'Play / pause'],
  ['Enter / Home', 'Return to start'],
  ['← / →', 'Seek −5 s / +5 s'],
  ['Shift + ← / →', 'Seek ∓1 bar (click on) or ±1 s'],
  ['C', 'Metronome on / off'],
  ['T', 'Tap tempo'],
  ['D', 'Set downbeat at playhead (Follow song: nearest beat becomes beat 1)'],
  ['[ / ]', 'Nudge grid / beat map −10 ms / +10 ms'],
  ['A', 'Anchor a beat at the playhead (Follow song)'],
  ['Shift + A', 'Anchor beat 1 at the playhead (Follow song)'],
  ['L', 'Loop the bar at the playhead / loop off'],
  ['Shift + L', 'Loop 4 bars from the playhead'],
  ['Shift + click ruler', 'Set the nearer loop edge (snapped to a bar)'],
  ['G', 'Gap click on / off'],
  ['P', 'Click practice on / off'],
  ['1 – 9', 'Focus track n'],
  ['M / S', 'Mute / solo the focused track'],
  ['Alt + S', 'Exclusive solo'],
  ['Shift + S', 'Clear all solos'],
  ['↑ / ↓', 'Focused track volume ±0.5 dB (Shift ±0.1)'],
  ['0', 'Reset focused track to 0 dB'],
  ['?', 'Show this sheet'],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        e.preventDefault(); // single focusable control: keep focus inside the dialog
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-zinc-900 p-5 text-zinc-100 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            Close
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs">{keys}</kbd></dt>
              <dd className="text-zinc-300">{what}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-zinc-400">Shortcuts are ignored while typing in a field.</p>
      </div>
    </div>
  );
}
