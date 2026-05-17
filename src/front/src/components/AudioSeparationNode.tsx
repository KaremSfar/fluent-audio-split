import { memo, useCallback, useContext, createContext } from 'react';
import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { MODEL_DEFINITIONS, getStemsForModel, STEM_COLORS } from '@/lib/models';

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
  const stems = getStemsForModel(modelName);

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onConfigChange(nodeId as string, JSON.stringify({ ...config, modelName: e.target.value }));
    },
    [nodeId, config, onConfigChange],
  );

  return (
    <div className="w-72 rounded-xl border-2 border-violet-400 bg-background shadow-lg" style={{ position: 'relative' }}>
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

      {/* Model selector — padded */}
      <div className="px-4 pt-3 pb-0 space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Model</label>
        <select
          value={modelName}
          onChange={handleModelChange}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {MODEL_DEFINITIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
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
  };
  return map[twClass] ?? '#8b5cf6';
}

export default memo(AudioSeparationNode);

