import { memo, useCallback, useContext, createContext } from 'react';
import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { MODEL_DEFINITIONS, getStemsForModel, STEM_COLORS, type EnsembleMethod } from '@/lib/models';

// ── Context for callbacks (avoids storing non-serializable fns in node data) ──
export interface NodeCallbacks {
  onConfigChange: (nodeId: string, configJson: string) => void;
  onRemove: (nodeId: string) => void;
}
export const NodeCallbacksContext = createContext<NodeCallbacks>({
  onConfigChange: () => {},
  onRemove: () => {},
});

export interface AudioSeparationNodeData {
  nodeId: string;
  configJson: string;
  isRoot: boolean;
  nodeIndex: number;
}

export type AudioSeparationRFNode = {
  id: string;
  type: 'audioSeparation';
  position: { x: number; y: number };
  data: AudioSeparationNodeData;
};

// ── Category labels for <optgroup> ────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  splitter: 'Splitter / Vocal Remover',
  debleed: 'Debleed',
  denoise: 'Denoise',
};

function AudioSeparationNode({ data }: NodeProps) {
  const { nodeId, configJson, isRoot, nodeIndex } = data as unknown as AudioSeparationNodeData;
  const { onConfigChange, onRemove } = useContext(NodeCallbacksContext);

  // Derive connected stems from live edges — no stale Set in data
  const edges = useEdges();
  const connectedStems = new Set(
    edges.filter((e) => e.source === nodeId).map((e) => e.sourceHandle ?? ''),
  );

  const config = (() => {
    try { return JSON.parse(configJson as string); } catch { return {}; }
  })();
  const modelName: string = config.modelName ?? 'htdemucs_ft.yaml';
  const ensembleModels: string[] = config.ensembleModels ?? [];
  const ensembleMethod: EnsembleMethod = config.ensembleMethod ?? 'avg';
  const ensembleEnabled: boolean = config.ensembleEnabled === true;
  const stems = getStemsForModel(modelName);

  // Compatible models for ensemble = same stem set as primary, not already added
  const stemsKey = [...stems].sort().join(',');
  const compatibleModels = MODEL_DEFINITIONS.filter(
    (m) =>
      m.value !== modelName &&
      !ensembleModels.includes(m.value) &&
      [...m.stems].sort().join(',') === stemsKey,
  );

  const updateConfig = useCallback(
    (patch: Record<string, unknown>) => {
      onConfigChange(nodeId as string, JSON.stringify({ ...config, ...patch }));
    },
    [nodeId, config, onConfigChange],
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      // Clear ensemble when model changes — stems may be incompatible
      updateConfig({ modelName: e.target.value, ensembleModels: [], ensembleEnabled: false });
    },
    [updateConfig],
  );

  const toggleEnsemble = useCallback(() => {
    if (ensembleEnabled) {
      updateConfig({ ensembleEnabled: false, ensembleModels: [] });
    } else {
      updateConfig({ ensembleEnabled: true });
    }
  }, [ensembleEnabled, updateConfig]);

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
      updateConfig({ ensembleModels: ensembleModels.filter((x) => x !== m) });
    },
    [ensembleModels, updateConfig],
  );

  const handleEnsembleMethodChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateConfig({ ensembleMethod: e.target.value as EnsembleMethod });
    },
    [updateConfig],
  );

  // Group MODEL_DEFINITIONS by category for <optgroup>
  const modelsByCategory = MODEL_DEFINITIONS.reduce<Record<string, typeof MODEL_DEFINITIONS>>(
    (acc, m) => {
      (acc[m.category] ??= []).push(m);
      return acc;
    },
    {},
  );

  return (
    <div className="w-80 rounded-xl border-2 border-violet-400 bg-background shadow-lg" style={{ position: 'relative' }}>
      {/* Input handle — left edge, vertically centered on full card */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          background: '#8b5cf6',
          width: 12,
          height: 12,
          border: '2px solid white',
          left: -6,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
      />

      {/* Header */}
      <div className="bg-violet-500 text-white rounded-t-xl px-4 py-2 flex items-center gap-2">
        <span className="text-lg">🎛️</span>
        <span className="font-semibold text-sm">Audio Separation</span>
        <Badge variant="secondary" className="ml-auto text-xs bg-violet-300 text-violet-900">
          Node {(nodeIndex as number) + 1}
        </Badge>
        {!isRoot && (
          <button
            onClick={() => onRemove(nodeId as string)}
            className="ml-1 text-violet-200 hover:text-white text-xs"
            title="Remove node"
          >
            ✕
          </button>
        )}
      </div>

      {/* Model selector — grouped by category */}
      <div className="px-4 pt-3 pb-0 space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Model</label>
        <select
          value={modelName}
          onChange={handleModelChange}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {Object.entries(modelsByCategory).map(([cat, models]) => (
            <optgroup key={cat} label={CATEGORY_LABELS[cat] ?? cat}>
              {models.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* ── Ensemble section ──────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-0">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Ensemble
          </label>
          {/* Toggle switch */}
          <button
            onClick={toggleEnsemble}
            title={ensembleEnabled ? 'Disable ensemble' : 'Enable ensemble — blend multiple models'}
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

        {ensembleEnabled && (
          <div className="mt-1 mb-1 space-y-2">
            {/* Blend method */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Blend</span>
              <select
                value={ensembleMethod}
                onChange={handleEnsembleMethodChange}
                className="flex h-7 flex-1 rounded-md border border-input bg-transparent px-2 py-0.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="avg">Average</option>
                <option value="median">Median</option>
              </select>
            </div>

            {/* Added models chips */}
            {ensembleModels.map((m) => {
              const def = MODEL_DEFINITIONS.find((d) => d.value === m);
              return (
                <div
                  key={m}
                  className="flex items-center gap-1 rounded-md bg-violet-50 border border-violet-200 px-2 py-1"
                >
                  <span className="text-xs flex-1 text-violet-800 truncate">{def?.label ?? m}</span>
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
            {compatibleModels.length > 0 ? (
              <select
                onChange={handleAddEnsembleModel}
                defaultValue=""
                className="flex h-7 w-full rounded-md border border-dashed border-violet-300 bg-transparent px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-muted-foreground"
              >
                <option value="" disabled>+ Add compatible model…</option>
                {compatibleModels.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            ) : (
              ensembleModels.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  No compatible models for ensemble with this selection
                </p>
              )
            )}
          </div>
        )}
      </div>

      {/* Output stems — rows extend full width so handles hit the card border */}
      <div className="pt-3 pb-3">
        <label className="px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
          Output Stems
        </label>
        {stems.map((stem) => {
          const color = STEM_COLORS[stem] ?? 'bg-slate-400';
          const dotColor = stemColorHex(color);
          const connected = connectedStems.has(stem);
          return (
            <div
              key={stem}
              className="flex items-center px-4 py-1"
              style={{ position: 'relative' }}
              title={connected ? `${stem} — connected` : `${stem} — drag to connect`}
            >
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full text-white ${color}`}>{stem}</span>
              <span className="ml-auto text-[10px] text-muted-foreground pr-4">
                {connected ? '● linked' : '○ open'}
              </span>
              {/* Handle sits on the right border of this row */}
              <Handle
                type="source"
                position={Position.Right}
                id={stem}
                style={{
                  position: 'absolute',
                  right: -6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: connected ? dotColor : 'white',
                  border: `2px solid ${dotColor}`,
                  width: 12,
                  height: 12,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function stemColorHex(twClass: string): string {
  const map: Record<string, string> = {
    'bg-rose-400': '#fb7185',
    'bg-amber-400': '#fbbf24',
    'bg-emerald-400': '#34d399',
    'bg-slate-400': '#94a3b8',
    'bg-orange-400': '#fb923c',
    'bg-sky-400': '#38bdf8',
    'bg-indigo-400': '#818cf8',
    'bg-red-300': '#fca5a5',
    'bg-teal-400': '#2dd4bf',
  };
  return map[twClass] ?? '#8b5cf6';
}

export default memo(AudioSeparationNode);

