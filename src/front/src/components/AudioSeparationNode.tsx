import { memo, useContext } from 'react';
import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
import { MODEL_DEFINITIONS, getStemsForModel, STEM_COLORS } from '@/lib/models';
import { NodeCallbacksContext } from '@/components/nodes/NodeCallbacksContext';
import { KeepToggle } from '@/components/nodes/KeepToggle';
import { NodeExecFooter } from '@/components/nodes/NodeExecFooter';
import { execBorderClass, type AudioSeparationNodeData } from '@/components/nodes/nodeData';
import { KEEP_COLOR, stemColorHex } from '@/components/nodes/stemColors';

export type { AudioSeparationNodeData } from '@/components/nodes/nodeData';

function AudioSeparationNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as AudioSeparationNodeData;
  const { nodeId, configJson, nodeIndex, execStatus, execCanPlay, keepStates, issues } = nodeData;
  const { onRemove, onPlayNode, onToggleKeep } = useContext(NodeCallbacksContext);

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
  const baseBorder = execStatus
    ? execBorderClass[execStatus] ?? 'border-violet-400'
    : selected
      ? 'border-violet-600 ring-2 ring-violet-300'
      : 'border-violet-400';

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
        id="in-0"
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
        <span className="font-semibold text-xs flex-1 truncate">Split · Node {nodeIndex + 1}</span>
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
          const keepState = keepStates?.[stem] ?? 'none';
          return (
            <div
              key={stem}
              className="group flex items-center gap-2 px-3 py-1"
              style={{ position: 'relative' }}
              title={connected ? `${stem} — connected` : `${stem} — drag to connect`}
            >
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full text-white ${color}`}>{stem}</span>
              <span className="ml-auto">
                <KeepToggle output={stem} state={keepState} onToggle={() => onToggleKeep(nodeId, stem)} />
              </span>
              <span className="text-[10px] text-muted-foreground pr-4 w-14">
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
                  boxShadow: keepState === 'kept' ? `0 0 0 3px ${KEEP_COLOR}` : undefined,
                  width: 12,
                  height: 12,
                }}
              />
            </div>
          );
        })}
      </div>

      {issues && issues.length > 0 && (
        <div className="border-t border-amber-300 px-3 py-1" title={issues.join('\n')}>
          <p className="text-[10px] text-amber-700 truncate">⚠ {issues[0]}</p>
        </div>
      )}

      {/* ── Execution status footer ── */}
      <NodeExecFooter {...nodeData} />
    </div>
  );
}

export default memo(AudioSeparationNode);
