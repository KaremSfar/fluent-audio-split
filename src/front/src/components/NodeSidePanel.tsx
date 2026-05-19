import { useState, useCallback, useMemo } from 'react';
import {
  MODEL_DEFINITIONS,
  ENSEMBLE_ALGORITHMS,
  ENSEMBLE_PRESETS,
  CATEGORY_LABELS,
  getStemsForModel,
  type EnsembleMethod,
  type ModelCategory,
  type EnsemblePreset,
} from '@/lib/models';
import { AdvancedParamsModal } from '@/components/AdvancedParamsModal';
import type { ModelArch } from '@/lib/advancedParams';

// ── Types ─────────────────────────────────────────────────────────────────────
interface NodeConfig {
  modelName?: string;
  stems?: string[];
  ensembleModels?: string[];
  ensembleMethod?: EnsembleMethod;
  ensembleEnabled?: boolean;
  advancedParams?: Record<string, unknown>;
}

interface NodeSidePanelProps {
  nodeId: string;
  nodeIndex: number;
  configJson: string;
  onConfigChange: (nodeId: string, configJson: string) => void;
  onClose: () => void;
}

// ── Arch filter options ───────────────────────────────────────────────────────
const ARCH_FILTERS: { value: ModelArch | 'all'; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'mdxc',  label: 'MDXC / Roformer' },
  { value: 'mdx',   label: 'MDX-Net' },
  { value: 'demucs',label: 'Demucs' },
  { value: 'vr',    label: 'VR Arch' },
];

// Category filter order
const CATEGORY_ORDER: ModelCategory[] = [
  'splitter', 'multistem', 'karaoke', 'denoise', 'dereverb', 'debleed', 'drums', 'specialty',
];

// ── Ensemble Presets Modal ────────────────────────────────────────────────────
function EnsemblePresetsModal({
  onApply,
  onClose,
}: {
  onApply: (preset: EnsemblePreset) => void;
  onClose: () => void;
}) {
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

// ── Main Side Panel ───────────────────────────────────────────────────────────
export function NodeSidePanel({ nodeId, nodeIndex, configJson, onConfigChange, onClose }: NodeSidePanelProps) {
  const config: NodeConfig = (() => {
    try { return JSON.parse(configJson); } catch { return {}; }
  })();

  const modelName: string         = config.modelName ?? 'htdemucs_ft.yaml';
  const ensembleModels: string[]  = config.ensembleModels ?? [];
  const ensembleMethod: EnsembleMethod = config.ensembleMethod ?? 'avg_wave';
  const ensembleEnabled: boolean  = config.ensembleEnabled === true;
  const advancedParams            = config.advancedParams ?? {};

  const modelDef = MODEL_DEFINITIONS.find(m => m.value === modelName);
  const arch = modelDef?.arch ?? 'mdxc';

  // ── Local filter state ────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [archFilter, setArchFilter] = useState<ModelArch | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<ModelCategory | 'all'>('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

  // ── Update helpers ────────────────────────────────────────────────────────
  const updateConfig = useCallback(
    (patch: Partial<NodeConfig>) => {
      onConfigChange(nodeId, JSON.stringify({ ...config, ...patch }));
    },
    [nodeId, config, onConfigChange],
  );

  // ── Model selection ───────────────────────────────────────────────────────
  const handleSelectModel = useCallback(
    (value: string) => {
      if (value === modelName) return;
      updateConfig({ modelName: value, stems: getStemsForModel(value), ensembleModels: [], ensembleEnabled: false });
    },
    [modelName, updateConfig],
  );

  // ── Ensemble ──────────────────────────────────────────────────────────────
  const toggleEnsemble = useCallback(() => {
    if (ensembleEnabled) {
      updateConfig({ ensembleEnabled: false, ensembleModels: [] });
    } else {
      updateConfig({ ensembleEnabled: true });
    }
  }, [ensembleEnabled, updateConfig]);

  const handleEnsembleMethodChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateConfig({ ensembleMethod: e.target.value as EnsembleMethod });
    },
    [updateConfig],
  );

  const handleAddEnsembleModel = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!e.target.value) return;
      updateConfig({ ensembleModels: [...ensembleModels, e.target.value] });
      e.target.value = '';
    },
    [ensembleModels, updateConfig],
  );

  const handleRemoveEnsembleModel = useCallback(
    (m: string) => {
      updateConfig({ ensembleModels: ensembleModels.filter(x => x !== m) });
    },
    [ensembleModels, updateConfig],
  );

  const handleApplyPreset = useCallback(
    (preset: EnsemblePreset) => {
      updateConfig({
        modelName: preset.models[0],
        stems: getStemsForModel(preset.models[0]),
        ensembleModels: preset.models.slice(1),
        ensembleMethod: preset.algorithm,
        ensembleEnabled: preset.models.length > 1,
      });
      setShowPresets(false);
    },
    [updateConfig],
  );

  // ── Filtered model list ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return MODEL_DEFINITIONS.filter(m => {
      if (archFilter !== 'all' && m.arch !== archFilter) return false;
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
      if (q && !m.label.toLowerCase().includes(q) && !m.value.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, archFilter, categoryFilter]);

  // Group filtered by category
  const grouped = useMemo(() => {
    const map = new Map<ModelCategory, typeof MODEL_DEFINITIONS>();
    for (const m of filtered) {
      if (!map.has(m.category)) map.set(m.category, []);
      map.get(m.category)!.push(m);
    }
    // Sort groups by canonical order
    return CATEGORY_ORDER.filter(c => map.has(c)).map(c => ({ category: c, models: map.get(c)! }));
  }, [filtered]);

  // Compatible ensemble models (same stem signature as primary)
  const stemsKey = [...(modelDef?.stems ?? [])].sort().join(',');
  const compatibleEnsemble = MODEL_DEFINITIONS.filter(
    m =>
      m.value !== modelName &&
      !ensembleModels.includes(m.value) &&
      [...m.stems].sort().join(',') === stemsKey,
  );

  // Available categories (for filter pills)
  const availableCategories = useMemo(() => {
    const archedModels = archFilter === 'all'
      ? MODEL_DEFINITIONS
      : MODEL_DEFINITIONS.filter(m => m.arch === archFilter);
    return new Set(archedModels.map(m => m.category));
  }, [archFilter]);

  return (
    <>
      <aside className="w-96 shrink-0 border-l bg-background flex flex-col overflow-hidden h-full">
        {/* Panel header */}
        <div className="bg-violet-500 text-white px-4 py-3 flex items-center gap-2 shrink-0">
          <span className="text-base">🎛️</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium opacity-80 uppercase tracking-wide">Configuring</p>
            <p className="font-semibold text-sm truncate">Node {nodeIndex + 1}</p>
          </div>
          <button
            onClick={onClose}
            className="text-violet-200 hover:text-white text-sm shrink-0"
            title="Close panel"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Model Browser ─────────────────────────────────────────────── */}
          <section className="px-3 pt-3 pb-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model</h3>
              <button
                onClick={() => setShowAdvanced(true)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-0.5 px-1.5 rounded hover:bg-muted/50 transition-colors"
                title="Advanced separation parameters"
              >
                <span>⚙</span>
                <span>Advanced</span>
              </button>
            </div>

            {/* Search */}
            <input
              type="text"
              placeholder="Search models…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-8 rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mb-2"
            />

            {/* Arch filter */}
            <div className="flex flex-wrap gap-1 mb-1.5">
              {ARCH_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => { setArchFilter(f.value); setCategoryFilter('all'); }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    archFilter === f.value
                      ? 'bg-violet-500 border-violet-500 text-white'
                      : 'border-border text-muted-foreground hover:border-violet-400 hover:text-foreground'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Category filter */}
            <div className="flex flex-wrap gap-1 mb-2">
              <button
                onClick={() => setCategoryFilter('all')}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  categoryFilter === 'all'
                    ? 'bg-slate-600 border-slate-600 text-white'
                    : 'border-border text-muted-foreground hover:border-slate-400 hover:text-foreground'
                }`}
              >
                All types
              </button>
              {CATEGORY_ORDER.filter(c => availableCategories.has(c)).map(c => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    categoryFilter === c
                      ? 'bg-slate-600 border-slate-600 text-white'
                      : 'border-border text-muted-foreground hover:border-slate-400 hover:text-foreground'
                  }`}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>

            {/* Model list */}
            <div className="rounded-md border border-border overflow-hidden mb-3 max-h-72 overflow-y-auto">
              {grouped.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No models match the filter</p>
              ) : (
                grouped.map(({ category, models }) => (
                  <div key={category}>
                    <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-3 py-1 border-b border-border">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {CATEGORY_LABELS[category]}
                      </span>
                    </div>
                    {models.map(m => {
                      const isSelected = m.value === modelName;
                      return (
                        <button
                          key={m.value}
                          onClick={() => handleSelectModel(m.value)}
                          className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors border-b last:border-b-0 border-border/50 ${
                            isSelected
                              ? 'bg-violet-50 dark:bg-violet-950/30'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          <span className={`mt-0.5 shrink-0 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-violet-500 bg-violet-500' : 'border-muted-foreground/40'
                          }`}>
                            {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs leading-tight ${isSelected ? 'text-violet-700 dark:text-violet-300 font-medium' : 'text-foreground'}`}>
                              {m.label}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-[9px] uppercase font-mono text-muted-foreground/60 bg-muted px-1 rounded">
                                {m.arch}
                              </span>
                              <span className="text-[9px] text-muted-foreground/50 truncate">
                                {m.stems.join(' · ')}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ── Ensemble ──────────────────────────────────────────────────── */}
          <section className="px-3 pb-3 border-t border-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ensemble</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPresets(true)}
                  className="text-[10px] text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"
                  title="Load an ensemble preset"
                >
                  ★ Presets
                </button>
                {/* Toggle switch */}
                <button
                  onClick={toggleEnsemble}
                  title={ensembleEnabled ? 'Disable ensemble' : 'Enable ensemble'}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                    ensembleEnabled ? 'bg-violet-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      ensembleEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </div>
            </div>

            {ensembleEnabled && (
              <div className="space-y-2">
                {/* Blend method */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">Blend</span>
                  <select
                    value={ensembleMethod}
                    onChange={handleEnsembleMethodChange}
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
                  <span className="text-xs flex-1 text-violet-800 dark:text-violet-200 truncate">{modelDef?.label ?? modelName}</span>
                </div>

                {/* Added ensemble model chips */}
                {ensembleModels.map(m => {
                  const def = MODEL_DEFINITIONS.find(d => d.value === m);
                  return (
                    <div
                      key={m}
                      className="flex items-center gap-1 rounded-md bg-violet-50 dark:bg-violet-950/20 border border-violet-200 px-2 py-1"
                    >
                      <span className="text-xs flex-1 text-violet-800 dark:text-violet-300 truncate">{def?.label ?? m}</span>
                      <button
                        onClick={() => handleRemoveEnsembleModel(m)}
                        className="text-violet-400 hover:text-violet-700 text-xs ml-1 shrink-0"
                        title="Remove from ensemble"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}

                {/* Add compatible model */}
                {compatibleEnsemble.length > 0 ? (
                  <select
                    onChange={handleAddEnsembleModel}
                    defaultValue=""
                    key={ensembleModels.length} // reset after add
                    className="flex h-7 w-full rounded-md border border-dashed border-violet-300 bg-transparent px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-muted-foreground"
                  >
                    <option value="" disabled>+ Add compatible model…</option>
                    {compatibleEnsemble.map(m => (
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

            {!ensembleEnabled && (
              <p className="text-xs text-muted-foreground">
                Enable to blend multiple models for better quality.
              </p>
            )}
          </section>
        </div>
      </aside>

      {showAdvanced && (
        <AdvancedParamsModal
          arch={arch}
          modelLabel={modelDef?.label ?? modelName}
          params={advancedParams}
          onChange={(key, val) => updateConfig({ advancedParams: { ...advancedParams, [key]: val } })}
          onReset={() => updateConfig({ advancedParams: {} })}
          onClose={() => setShowAdvanced(false)}
        />
      )}

      {showPresets && (
        <EnsemblePresetsModal
          onApply={handleApplyPreset}
          onClose={() => setShowPresets(false)}
        />
      )}
    </>
  );
}
