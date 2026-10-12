import type { NodeExecutionStatus } from '@/types/execution';
import type { KeepState } from '@/lib/workflowGraph';

// Execution overlay (set when an execution is active/loaded)
export interface NodeExecOverlay {
  execStatus?: NodeExecutionStatus;
  execStartedAt?: string;
  execCompletedAt?: string;
  execErrorMessage?: string;
  execAttempt?: number;
  execOutputPaths?: Record<string, string>;
  execNodeExecutionId?: string;
  execCanPlay?: boolean;
}

export interface BaseNodeData extends NodeExecOverlay {
  nodeId: string;
  configJson: string;
  isRoot: boolean;
  nodeIndex: number;
  keptOutputs: string[];
  // Derived per render by the canvas page.
  keepStates?: Record<string, KeepState>;
  issues?: string[];
}

export interface AudioSeparationNodeData extends BaseNodeData {
  nodeType: 'AudioSeparation';
}

export interface MergeNodeInputData {
  label: string;
  gainDb: number;
}

export interface MergeNodeData extends BaseNodeData {
  nodeType: 'Merge';
  inputs: MergeNodeInputData[];
  outputLabel: string;
}

export const execBorderClass: Record<string, string> = {
  Pending: 'border-slate-300',
  Queued: 'border-slate-300',
  Running: 'border-blue-500 ring-2 ring-blue-300',
  Completed: 'border-green-500',
  Failed: 'border-red-500',
  Cancelled: 'border-slate-400',
};
