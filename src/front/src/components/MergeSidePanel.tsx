import { useCallback } from 'react';
import type { MergeConfig } from '@/types/workflow';
import { getMergeGains, parseConfig } from '@/lib/workflowGraph';

interface MergeSidePanelProps {
  nodeId: string;
  nodeIndex: number;
  configJson: string;
  /** Source label per input ("Node 2 · Vocals"), index-aligned with the input handles. */
  inputLabels: string[];
  /** Default output name shown as the label placeholder. */
  defaultLabel: string;
  onConfigChange: (nodeId: string, configJson: string) => void;
  onRemoveInput: (nodeId: string, inputIndex: number) => void;
  onClose: () => void;
}

const LEVEL_MODES: { value: NonNullable<MergeConfig['levelMode']>; label: string }[] = [
  { value: 'preventClipping', label: 'Prevent clipping (default)' },
  { value: 'normalizePeak', label: 'Normalize peak to −1 dBFS' },
  { value: 'none', label: 'None (may clip)' },
];

const MIN_GAIN_DB = -24;
const MAX_GAIN_DB = 6;

export function MergeSidePanel({
  nodeId, nodeIndex, configJson, inputLabels, defaultLabel, onConfigChange, onRemoveInput, onClose,
}: MergeSidePanelProps) {
  const config = parseConfig<MergeConfig>(configJson);
  const gains = getMergeGains(configJson, inputLabels.length);
  const levelMode = config.levelMode ?? 'preventClipping';

  const update = useCallback(
    (patch: Partial<MergeConfig>) => onConfigChange(nodeId, JSON.stringify({ ...config, ...patch })),
    [nodeId, config, onConfigChange],
  );

  const setGain = (idx: number, db: number) => {
    const next = gains.slice();
    next[idx] = Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, db));
    update({ inputGainsDb: next });
  };

  return (
    <aside className="w-96 shrink-0 border-l bg-card flex flex-col overflow-hidden h-full">
      <div className="bg-teal-700 text-white px-4 py-3 flex items-center gap-2 shrink-0">
        <span className="text-base" aria-hidden="true">⧉</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium opacity-80 uppercase tracking-wide">Configuring</p>
          <p className="font-semibold text-sm truncate">Merge · Node {nodeIndex + 1}</p>
        </div>
        <button onClick={onClose} className="text-teal-100 hover:text-white text-sm shrink-0" title="Close panel">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Label */}
        <div className="space-y-1.5">
          <label htmlFor={`merge-label-${nodeId}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Output name
          </label>
          <input
            id={`merge-label-${nodeId}`}
            type="text"
            value={config.label ?? ''}
            placeholder={defaultLabel}
            maxLength={80}
            onChange={(e) => update({ label: e.target.value || undefined })}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
        </div>

        {/* Inputs */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inputs</p>
          {inputLabels.length === 0 && (
            <p className="text-xs text-muted-foreground">Connect at least 2 stems to this node.</p>
          )}
          {inputLabels.map((label, i) => (
            <div key={i} className="rounded-md border p-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm flex-1 truncate" title={label}>{label}</span>
                <span className="text-xs font-mono text-muted-foreground w-16 text-right">
                  {gains[i] > 0 ? '+' : ''}{gains[i].toFixed(1)} dB
                </span>
                <button
                  type="button"
                  aria-label={`Remove input ${label}`}
                  title="Remove input"
                  className="text-xs text-muted-foreground hover:text-red-500 dark:hover:text-red-400 px-1"
                  onClick={() => onRemoveInput(nodeId, i)}
                >
                  ✕
                </button>
              </div>
              <input
                type="range"
                min={MIN_GAIN_DB}
                max={MAX_GAIN_DB}
                step={0.5}
                value={gains[i]}
                aria-label={`${label} gain`}
                aria-valuetext={`${gains[i].toFixed(1)} dB`}
                onChange={(e) => setGain(i, Number(e.target.value))}
                onDoubleClick={() => setGain(i, 0)}
                className="w-full accent-teal-600"
              />
            </div>
          ))}
        </div>

        {/* Level mode */}
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Level</legend>
          {LEVEL_MODES.map((m) => (
            <label key={m.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name={`merge-level-${nodeId}`}
                checked={levelMode === m.value}
                onChange={() => update({ levelMode: m.value })}
                className="accent-teal-600"
              />
              {m.label}
            </label>
          ))}
        </fieldset>

        <p className="text-xs text-muted-foreground">
          Inputs are summed at their gains, and shorter stems are padded with silence.
        </p>
      </div>
    </aside>
  );
}
