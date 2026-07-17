import {
  ENSEMBLE_PRESETS,
  ENSEMBLE_ALGORITHMS,
  MODEL_DEFINITIONS,
  type EnsemblePreset,
} from '@/lib/models';

interface EnsemblePresetsModalProps {
  onApply: (preset: EnsemblePreset) => void;
  onClose: () => void;
}

export function EnsemblePresetsModal({ onApply, onClose }: EnsemblePresetsModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg mx-4 rounded-xl border bg-background shadow-xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-sm">Ensemble Presets</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Community-curated model combinations</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Preset list */}
        <div className="overflow-y-auto flex-1 p-3 space-y-2">
          {ENSEMBLE_PRESETS.map((preset) => {
            const algo = ENSEMBLE_ALGORITHMS.find(a => a.value === preset.algorithm);
            return (
              <button
                key={preset.id}
                onClick={() => onApply(preset)}
                className="w-full text-left rounded-lg border border-border bg-card hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 p-3 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm">{preset.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">
                    {algo?.label.split(' —')[0] ?? preset.algorithm}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{preset.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {preset.models.map((m, i) => {
                    const def = MODEL_DEFINITIONS.find(d => d.value === m);
                    return (
                      <span
                        key={m}
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          i === 0
                            ? 'bg-violet-100 border-violet-300 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300'
                            : 'bg-muted border-muted-foreground/20 text-muted-foreground'
                        }`}
                      >
                        {i === 0 ? '⚡ ' : '+ '}
                        {def?.label ?? m}
                      </span>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1.5">by {preset.contributor}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
