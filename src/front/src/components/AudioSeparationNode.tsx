import { memo, useContext, createContext } from 'react';
import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
import { MODEL_DEFINITIONS, getStemsForModel, STEM_COLORS } from '@/lib/models';
import { useNowTick } from '@/hooks/useNowTick';

// ── Context for callbacks (avoids storing non-serializable fns in node data) ──
export interface NodeCallbacks {
  onConfigChange: (nodeId: string, configJson: string) => void;
  onRemove: (nodeId: string) => void;
  onPlayNode: (nodeId: string) => void;
}
export const NodeCallbacksContext = createContext<NodeCallbacks>({
  onConfigChange: () => {},
  onRemove: () => {},
  onPlayNode: () => {},
});

export interface AudioSeparationNodeData {
  nodeId: string;
  configJson: string;
  isRoot: boolean;
  nodeIndex: number;
  // Execution overlay (set when an execution is active/loaded)
  execStatus?: import('@/types/execution').NodeExecutionStatus;
  execStartedAt?: string;
  execCompletedAt?: string;
  execErrorMessage?: string;
  execAttempt?: number;
  execOutputPaths?: Record<string, string>;
  execNodeExecutionId?: string;
  execCanPlay?: boolean;
}

export type AudioSeparationRFNode = {
  id: string;
  type: 'audioSeparation';
  position: { x: number; y: number };
  data: AudioSeparationNodeData;
};

function AudioSeparationNode({ data, selected }: NodeProps) {
  const {
    nodeId, configJson, nodeIndex,
    execStatus, execStartedAt, execCompletedAt, execErrorMessage,
    execCanPlay,
  } = data as unknown as AudioSeparationNodeData;
  const { onRemove, onPlayNode } = useContext(NodeCallbacksContext);

  // The "Running" elapsed time is derived from the wall-clock at render time; tick so it advances.
  const now = useNowTick(execStatus === 'Running');

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

  // ── Execution-aware border & styles ──
  const borderByStatus: Record<string, string> = {
    Pending: 'border-slate-300',
    Queued: 'border-slate-300',
    Running: 'border-blue-500 ring-2 ring-blue-300',
    Completed: 'border-green-500',
    Failed: 'border-red-500',
    Cancelled: 'border-slate-400',
  };
  const baseBorder = execStatus
    ? borderByStatus[execStatus] ?? 'border-violet-400'
    : selected
      ? 'border-violet-600 ring-2 ring-violet-300'
      : 'border-violet-400';

  // ── Duration helper ──
  const elapsed = (() => {
    if (!execStartedAt) return null;
    const start = new Date(execStartedAt).getTime();
    const end = execCompletedAt ? new Date(execCompletedAt).getTime() : now;
    const s = Math.round((end - start) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  })();

  // ── Status footer config ──
  const statusFooter: Record<string, { icon: string; label: string; color: string }> = {
    Pending: { icon: '○', label: 'Pending', color: 'text-slate-400' },
    Queued: { icon: '○', label: 'Queued', color: 'text-slate-400' },
    Running: { icon: '⏳', label: 'Running', color: 'text-blue-600' },
    Completed: { icon: '✅', label: 'Done', color: 'text-green-600' },
    Failed: { icon: '✗', label: 'Failed', color: 'text-red-600' },
    Cancelled: { icon: '—', label: 'Cancelled', color: 'text-slate-500' },
  };
  const footer = execStatus ? statusFooter[execStatus] : null;

  // ── Play button logic ──
  const isRunningOrPending = execStatus === 'Running' || execStatus === 'Pending' || execStatus === 'Queued';
  const showPlay = execCanPlay && !isRunningOrPending;
  const playLabel = execStatus === 'Failed' ? '↻ Retry' : execStatus === 'Completed' ? '↻ Re-run' : '▶ Run';

  return (
    <div
      className={`w-64 rounded-xl border-2 ${baseBorder} bg-background shadow-lg transition-all ${execStatus === 'Running' ? 'animate-pulse-subtle' : ''}`}
      style={{ position: 'relative' }}
    >
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
        {/* Play button in header */}
        {showPlay && (
          <button
            onClick={(e) => { e.stopPropagation(); onPlayNode(nodeId as string); }}
            className="ml-0.5 bg-white/20 hover:bg-white/40 text-white text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 transition-colors"
            title={playLabel}
          >
            {playLabel}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(nodeId as string); }}
          className="ml-1 text-violet-200 hover:text-white text-xs shrink-0"
          title="Remove node"
        >
          ✕
        </button>
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

      {/* Click hint when not selected and no execution active */}
      {!selected && !execStatus && (
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

      {/* ── Execution status footer ── */}
      {footer && (
        <div className={`border-t border-border/50 px-3 py-1.5 flex items-center gap-2 ${footer.color}`}>
          <span className="text-sm">{footer.icon}</span>
          <span className="text-xs font-medium">{footer.label}</span>
          {elapsed && <span className="text-[10px] text-muted-foreground ml-auto">{elapsed}</span>}
        </div>
      )}

      {/* Failed error snippet */}
      {execStatus === 'Failed' && execErrorMessage && (
        <div className="px-3 pb-2">
          <p className="text-[9px] text-red-500 truncate" title={execErrorMessage}>{execErrorMessage}</p>
        </div>
      )}
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
