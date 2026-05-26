import { useState, useMemo } from 'react';
import {
  MODEL_DEFINITIONS,
  CATEGORY_LABELS,
  type ModelCategory,
} from '@/lib/models';
import type { ModelArch } from '@/lib/advancedParams';

interface ModelBrowserProps {
  selectedModel: string;
  onSelectModel: (modelValue: string) => void;
  onOpenAdvanced: () => void;
}

const ARCH_FILTERS: { value: ModelArch | 'all'; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'mdxc',  label: 'MDXC / Roformer' },
  { value: 'mdx',   label: 'MDX-Net' },
  { value: 'demucs',label: 'Demucs' },
  { value: 'vr',    label: 'VR Arch' },
];

const CATEGORY_ORDER: ModelCategory[] = [
  'splitter', 'multistem', 'karaoke', 'denoise', 'dereverb', 'debleed', 'drums', 'specialty',
];

export function ModelBrowser({ selectedModel, onSelectModel, onOpenAdvanced }: ModelBrowserProps) {
  const [search, setSearch] = useState('');
  const [archFilter, setArchFilter] = useState<ModelArch | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<ModelCategory | 'all'>('all');

  // Filtered model list
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

  // Available categories (for filter pills)
  const availableCategories = useMemo(() => {
    const archedModels = archFilter === 'all'
      ? MODEL_DEFINITIONS
      : MODEL_DEFINITIONS.filter(m => m.arch === archFilter);
    return new Set(archedModels.map(m => m.category));
  }, [archFilter]);

  return (
    <section className="px-3 pt-3 pb-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model</h3>
        <button
          onClick={onOpenAdvanced}
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
                const isSelected = m.value === selectedModel;
                return (
                  <button
                    key={m.value}
                    onClick={() => onSelectModel(m.value)}
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
  );
}
