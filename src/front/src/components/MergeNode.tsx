import { memo, useContext, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { MERGE_OUTPUT } from '@/types/workflow';
import { MAX_MERGE_INPUTS, MIN_MERGE_INPUTS, inHandleId, parseConfig } from '@/lib/workflowGraph';
import type { MergeConfig } from '@/types/workflow';
import { NodeCallbacksContext } from '@/components/nodes/NodeCallbacksContext';
import { KeepToggle } from '@/components/nodes/KeepToggle';
import { NodeExecFooter } from '@/components/nodes/NodeExecFooter';
import { execBorderClass, type MergeNodeData } from '@/components/nodes/nodeData';
import { KEEP_COLOR, MERGE_COLOR } from '@/components/nodes/stemColors';

export type { MergeNodeData } from '@/components/nodes/nodeData';

const LEVEL_LABEL: Record<NonNullable<MergeConfig['levelMode']>, string> = {
  preventClipping: 'prevent clipping (−1 dBFS)',
  normalizePeak: 'normalize peak (−1 dBFS)',
  none: 'none (may clip)',
};

const handleStyle = (filled: boolean) => ({
  position: 'absolute' as const,
  left: -6,
  top: '50%',
  transform: 'translateY(-50%)',
  background: filled ? MERGE_COLOR : 'hsl(var(--card))',
  border: `2px solid ${MERGE_COLOR}`,
  width: 12,
  height: 12,
});

function formatGain(db: number): string {
  if (db === 0) return '0.0 dB';
  return `${db > 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`;
}

function MergeNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as MergeNodeData;
  const { nodeId, configJson, nodeIndex, inputs, outputLabel, execStatus, execCanPlay, keepStates, issues } = nodeData;
  const { onRemove, onPlayNode, onToggleKeep, onRemoveInput } = useContext(NodeCallbacksContext);
  const updateNodeInternals = useUpdateNodeInternals();

  const config = parseConfig<MergeConfig>(configJson);
  const levelMode = config.levelMode ?? 'preventClipping';

  // One extra empty slot (dynamic ports), capped at MAX_MERGE_INPUTS.
  const portCount = Math.min(inputs.length + 1, MAX_MERGE_INPUTS);
  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [nodeId, portCount, updateNodeInternals]);

  const invalid = inputs.length < MIN_MERGE_INPUTS;
  const keepState = keepStates?.[MERGE_OUTPUT] ?? 'none';

  const baseBorder = execStatus
    ? execBorderClass[execStatus] ?? 'border-teal-500'
    : selected
      ? 'border-teal-700 ring-2 ring-teal-300 dark:border-teal-400 dark:ring-teal-500/50'
      : invalid
        ? 'border-amber-400 border-dashed'
        : 'border-teal-500';

  const isRunningOrPending = execStatus === 'Running' || execStatus === 'Pending' || execStatus === 'Queued';
  const showPlay = execCanPlay && !isRunningOrPending;
  const playLabel = execStatus === 'Failed' ? '↻ Retry' : execStatus === 'Completed' ? '↻ Re-run' : '▶ Run';

  return (
    <div
      className={`w-64 rounded-xl border-2 ${baseBorder} bg-card text-card-foreground shadow-lg dark:shadow-black/40 transition-all ${execStatus === 'Running' ? 'animate-pulse-subtle' : ''}`}
      style={{ position: 'relative' }}
    >
      {/* Header */}
      <div className="bg-teal-700 text-white rounded-t-[10px] px-3 py-2 flex items-center gap-2">
        <span className="text-base" aria-hidden="true">⧉</span>
        <span className="font-semibold text-xs flex-1 truncate">Merge · Node {nodeIndex + 1}</span>
        {showPlay && (
          <button
            onClick={(e) => { e.stopPropagation(); onPlayNode(nodeId); }}
            className="ml-0.5 bg-white/20 hover:bg-white/40 text-white text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 transition-colors"
            title={playLabel}
          >
            {playLabel}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(nodeId); }}
          className="ml-1 text-teal-100 hover:text-white text-xs shrink-0"
          title="Remove node"
        >
          ✕
        </button>
      </div>

      {/* Input ports: one per input plus one empty slot */}
      <div className="py-1">
        {Array.from({ length: portCount }, (_, i) => {
          const input = inputs[i];
          return (
            <div
              key={i}
              className="group relative flex items-center gap-2 px-3 py-1 min-h-7"
              title={input ? `${input.label} (in-${i})` : 'Drop a stem here to add an input'}
            >
              <Handle type="target" position={Position.Left} id={inHandleId(i)} style={handleStyle(!!input)} />
              {input ? (
                <>
                  <span className="text-xs truncate flex-1">{input.label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{formatGain(input.gainDb)}</span>
                  <button
                    type="button"
                    aria-label={`Remove input ${input.label}`}
                    title="Remove input"
                    className="nodrag nopan text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-500 dark:hover:text-red-400"
                    onClick={(e) => { e.stopPropagation(); onRemoveInput(nodeId, i); }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <span className="text-[10px] italic text-muted-foreground/60">+ drop a stem here</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Single output */}
      <div className="border-t border-border/50 pt-2 pb-2">
        <div className="group relative flex items-center gap-2 px-3 py-1">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white bg-teal-700 truncate max-w-[110px]" title={outputLabel}>
            {outputLabel}
          </span>
          <span className="ml-auto">
            <KeepToggle output={MERGE_OUTPUT} state={keepState} onToggle={() => onToggleKeep(nodeId, MERGE_OUTPUT)} />
          </span>
          <span className="w-4" />
          <Handle
            type="source"
            position={Position.Right}
            id={MERGE_OUTPUT}
            style={{
              position: 'absolute',
              right: -6,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'hsl(var(--card))',
              border: `2px solid ${MERGE_COLOR}`,
              boxShadow: keepState === 'kept' ? `0 0 0 3px ${KEEP_COLOR}` : undefined,
              width: 12,
              height: 12,
            }}
          />
        </div>
        <p className="px-3 text-[10px] text-muted-foreground">Level: {LEVEL_LABEL[levelMode] ?? levelMode}</p>
      </div>

      {invalid && (
        <div className="border-t border-amber-300 dark:border-amber-700/70 px-3 py-1">
          <p className="text-[10px] text-amber-700 dark:text-amber-300">Needs at least {MIN_MERGE_INPUTS} stems</p>
        </div>
      )}
      {!invalid && issues && issues.length > 0 && (
        <div className="border-t border-amber-300 dark:border-amber-700/70 px-3 py-1" title={issues.join('\n')}>
          <p className="text-[10px] text-amber-700 dark:text-amber-300 truncate">⚠ {issues[0]}</p>
        </div>
      )}

      <NodeExecFooter {...nodeData} />
    </div>
  );
}

export default memo(MergeNode);
