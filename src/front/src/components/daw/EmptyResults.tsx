import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { AvailableStem } from '@/types/results';
import { AddTrackPopover } from './AddTrackPopover';

interface EmptyResultsProps {
  failed: boolean;
  canvasHref: string;
  detailsHref: string;
  available: AvailableStem[];
  onAdd: (stem: AvailableStem) => void;
}

export function EmptyResults({ failed, canvasHref, detailsHref, available, onAdd }: EmptyResultsProps) {
  return (
    <div className="flex flex-col items-center gap-3 bg-zinc-950 px-6 py-16 text-center text-zinc-200">
      <p className="text-lg font-medium">No stems to play</p>
      <p className="max-w-md text-sm text-zinc-400">
        {failed
          ? 'The run did not produce any stems. Check the execution details for the error.'
          : 'Nothing was kept and no terminal stems were produced.'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link to={canvasHref}><Button variant="outline" size="sm">Open canvas</Button></Link>
        {failed && <Link to={detailsHref}><Button variant="outline" size="sm">View execution details</Button></Link>}
        {available.length > 0 && <AddTrackPopover available={available} onAdd={onAdd} />}
      </div>
    </div>
  );
}
