import { useState, useCallback } from 'react';
import {
  MODEL_DEFINITIONS,
  getStemsForModel,
  type EnsembleMethod,
  type EnsemblePreset,
} from '@/lib/models';
import { AdvancedParamsModal } from '@/components/AdvancedParamsModal';
import { EnsemblePresetsModal } from '@/components/workflow/EnsemblePresetsModal';
import { ModelBrowser } from '@/components/workflow/ModelBrowser';
import { EnsembleConfig } from '@/components/workflow/EnsembleConfig';

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

  // ── Local UI state ────────────────────────────────────────────────────────
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
    (method: EnsembleMethod) => {
      updateConfig({ ensembleMethod: method });
    },
    [updateConfig],
  );

  const handleAddEnsembleModel = useCallback(
    (modelValue: string) => {
      updateConfig({ ensembleModels: [...ensembleModels, modelValue] });
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

  // ── Compatible ensemble models (same stem signature as primary) ──────────
  const stemsKey = [...(modelDef?.stems ?? [])].sort().join(',');
  const compatibleEnsemble = MODEL_DEFINITIONS.filter(
    m =>
      m.value !== modelName &&
      !ensembleModels.includes(m.value) &&
      [...m.stems].sort().join(',') === stemsKey,
  );

  // Prepare ensemble model list with labels
  const ensembleModelList = ensembleModels.map(m => {
    const def = MODEL_DEFINITIONS.find(d => d.value === m);
    return { value: m, label: def?.label ?? m };
  });

  // Prepare compatible models list with labels
  const compatibleModelList = compatibleEnsemble.map(m => ({
    value: m.value,
    label: m.label,
  }));

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
          <ModelBrowser
            selectedModel={modelName}
            onSelectModel={handleSelectModel}
            onOpenAdvanced={() => setShowAdvanced(true)}
          />

          {/* ── Ensemble ──────────────────────────────────────────────────── */}
          <EnsembleConfig
            enabled={ensembleEnabled}
            method={ensembleMethod}
            primaryModelLabel={modelDef?.label ?? modelName}
            ensembleModels={ensembleModelList}
            compatibleModels={compatibleModelList}
            onToggle={toggleEnsemble}
            onMethodChange={handleEnsembleMethodChange}
            onAddModel={handleAddEnsembleModel}
            onRemoveModel={handleRemoveEnsembleModel}
            onOpenPresets={() => setShowPresets(true)}
          />
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
