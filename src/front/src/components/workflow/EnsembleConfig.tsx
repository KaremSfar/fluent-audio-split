import { ENSEMBLE_ALGORITHMS, type EnsembleMethod } from '@/lib/models';

interface ModelOption {
  value: string;
  label: string;
}

interface EnsembleConfigProps {
  enabled: boolean;
  method: EnsembleMethod;
  primaryModelLabel: string;
  ensembleModels: Array<{ value: string; label: string }>;
  compatibleModels: ModelOption[];
  onToggle: () => void;
  onMethodChange: (method: EnsembleMethod) => void;
  onAddModel: (modelValue: string) => void;
  onRemoveModel: (modelValue: string) => void;
  onOpenPresets: () => void;
}

export function EnsembleConfig({
  enabled,
  method,
  primaryModelLabel,
  ensembleModels,
  compatibleModels,
  onToggle,
  onMethodChange,
  onAddModel,
  onRemoveModel,
  onOpenPresets,
}: EnsembleConfigProps) {
  return (
    <section className="px-3 pb-3 border-t border-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ensemble</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenPresets}
            className="text-[10px] text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"
            title="Load an ensemble preset"
          >
            ★ Presets
          </button>
          {/* Toggle switch */}
          <button
            onClick={onToggle}
            title={enabled ? 'Disable ensemble' : 'Enable ensemble'}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${
              enabled ? 'bg-violet-500' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`}
            />
          </button>
        </div>
      </div>

      {enabled && (
        <div className="space-y-2">
          {/* Blend method */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Blend</span>
            <select
              value={method}
              onChange={(e) => onMethodChange(e.target.value as EnsembleMethod)}
              className="flex h-7 flex-1 rounded-md border border-input bg-transparent px-2 py-0.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {Object.entries(
                ENSEMBLE_ALGORITHMS.reduce<Record<string, typeof ENSEMBLE_ALGORITHMS>>(
                  (acc, a) => { (acc[a.group] ??= []).push(a); return acc; }, {}
                )
              ).map(([group, algos]) => (
                <optgroup key={group} label={group}>
                  {algos.map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Primary model chip */}
          <div className="flex items-center gap-1 rounded-md bg-violet-100 dark:bg-violet-900/30 border border-violet-300 px-2 py-1">
            <span className="text-[10px] text-violet-500 font-semibold shrink-0">PRIMARY</span>
            <span className="text-xs flex-1 text-violet-800 dark:text-violet-200 truncate">{primaryModelLabel}</span>
          </div>

          {/* Added ensemble model chips */}
          {ensembleModels.map(m => (
            <div
              key={m.value}
              className="flex items-center gap-1 rounded-md bg-violet-50 dark:bg-violet-950/20 border border-violet-200 px-2 py-1"
            >
              <span className="text-xs flex-1 text-violet-800 dark:text-violet-300 truncate">{m.label}</span>
              <button
                onClick={() => onRemoveModel(m.value)}
                className="text-violet-400 hover:text-violet-700 text-xs ml-1 shrink-0"
                title="Remove from ensemble"
              >
                ✕
              </button>
            </div>
          ))}

          {/* Add compatible model */}
          {compatibleModels.length > 0 ? (
            <select
              onChange={(e) => {
                if (e.target.value) {
                  onAddModel(e.target.value);
                  e.target.value = '';
                }
              }}
              defaultValue=""
              key={ensembleModels.length} // reset after add
              className="flex h-7 w-full rounded-md border border-dashed border-violet-300 bg-transparent px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-muted-foreground"
            >
              <option value="" disabled>+ Add compatible model…</option>
              {compatibleModels.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          ) : ensembleModels.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No compatible models for ensemble with this selection
            </p>
          ) : null}
        </div>
      )}

      {!enabled && (
        <p className="text-xs text-muted-foreground">
          Enable to blend multiple models for better quality.
        </p>
      )}
    </section>
  );
}
