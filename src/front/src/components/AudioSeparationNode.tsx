import { memo, useContext, createContext } from 'react';
import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
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

function AudioSeparationNode({ data, selected }: NodeProps) {
  const { nodeId, configJson, isRoot, nodeIndex } = data as unknown as AudioSeparationNodeData;
  const { onRemove } = useContext(NodeCallbacksContext);

  const edges = useEdges();
  const connectedStems = new Set(
    edges.filter((e) => e.source === nodeId).map((e) => e.sourceHandle ?? ''),
  );

  const config = (() => {
    try { return JSON.parse(configJson as string); } catch { return {}; }
  })();
  const modelName: string = config.modelName ?? 'htdemucs_ft.yaml';
  const ensembleModels: string[] = config.ensembleModels ?? [];
  const ensembleEnabled: boolean = config.ensembleEnabled === true;
  const stems = getStemsForModel(modelName);

  const modelDef = MODEL_DEFINITIONS.find((m) => m.value === modelName);
  const arch = modelDef?.arch ?? 'mdxc';

  const borderClass = selected
    ? 'border-violet-600 ring-2 ring-violet-300'
    : 'border-violet-400';

  return (
    <div className={`w-64 rounded-xl border-2 ${borderClass} bg-background shadow-lg transition-shadow`} style={{ position: 'relative' }}>
      {/* Input handle */}
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
      <div className="bg-violet-500 text-white rounded-t-xl px-3 py-2 flex items-center gap-2">
        <span className="text-base">🎛️</span>
        <span className="font-semibold text-xs flex-1 truncate">Node {(nodeIndex as number) + 1}</span>
        <span className="text-[9px] font-mono uppercase bg-violet-400/60 rounded px-1.5 py-0.5">{arch}</span>
        {!isRoot && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(nodeId as string); }}
            className="ml-1 text-violet-200 hover:text-white text-xs shrink-0"
            title="Remove node"
          >
            ✕
          </button>
        )}
      </div>

      {/* Model label */}
      <div className="px-3 py-2 border-b border-border/50">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Model</p>
        <p className="text-xs text-foreground truncate leading-snug">{modelDef?.label ?? modelName}</p>
        {ensembleEnabled && ensembleModels.length > 0 && (
          <p className="text-[9px] text-violet-500 mt-0.5 font-medium">
            + {ensembleModels.length} ensemble model{ensembleModels.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Click hint when not selected */}
      {!selected && (
        <div className="px-3 py-1 border-b border-border/30">
          <p className="text-[9px] text-muted-foreground/50 italic text-center">click to configure</p>
        </div>
      )}

      {/* Output stems */}
      <div className="pt-2 pb-2">
        {stems.map((stem) => {
          const color = STEM_COLORS[stem] ?? 'bg-slate-400';
          const dotColor = stemColorHex(color);
          const connected = connectedStems.has(stem);
          return (
            <div
              key={stem}
              className="flex items-center px-3 py-1"
              style={{ position: 'relative' }}
              title={connected ? `${stem} — connected` : `${stem} — drag to connect`}
            >
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full text-white ${color}`}>{stem}</span>
              <span className="ml-auto text-[10px] text-muted-foreground pr-4">
                {connected ? '● linked' : '○ open'}
              </span>
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
    'bg-cyan-400': '#22d3ee',
    'bg-blue-300': '#93c5fd',
    'bg-lime-400': '#a3e635',
    'bg-yellow-300': '#fde047',
    'bg-orange-300': '#fdba74',
    'bg-green-300': '#86efac',
    'bg-red-400': '#f87171',
    'bg-yellow-400': '#facc15',
    'bg-emerald-300': '#6ee7b7',
    'bg-teal-300': '#5eead4',
    'bg-blue-400': '#60a5fa',
    'bg-pink-400': '#f472b6',
    'bg-purple-300': '#d8b4fe',
    'bg-sky-300': '#7dd3fc',
    'bg-slate-300': '#cbd5e1',
    'bg-violet-300': '#c4b5fd',
    'bg-green-400': '#4ade80',
    'bg-emerald-200': '#a7f3d0',
    'bg-amber-200': '#fde68a',
  };
  return map[twClass] ?? '#8b5cf6';
}

export default memo(AudioSeparationNode);
