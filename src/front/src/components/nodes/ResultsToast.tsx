import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export const RESULTS_TOAST_MS = 4000;

interface ResultsToastProps {
  onOpen: () => void;
  onStay: () => void;
}

/** Auto-opens Results after 4s unless the user opts to stay on the canvas. */
export function ResultsToast({ onOpen, onStay }: ResultsToastProps) {
  const [filling, setFilling] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFilling(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    const t = setTimeout(onOpen, RESULTS_TOAST_MS);
    return () => clearTimeout(t);
  }, [onOpen]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-80 overflow-hidden rounded-md border bg-background shadow-lg"
    >
      <div className="px-4 py-3 space-y-2">
        <p className="text-sm font-medium">Execution finished. Opening results…</p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onOpen}>Open now</Button>
          <Button size="sm" variant="outline" onClick={onStay}>Stay on canvas</Button>
        </div>
      </div>
      <div
        className="h-1 bg-violet-500 motion-reduce:transition-none"
        style={{ width: filling ? '100%' : '0%', transition: `width ${RESULTS_TOAST_MS}ms linear` }}
        aria-hidden="true"
      />
    </div>
  );
}
