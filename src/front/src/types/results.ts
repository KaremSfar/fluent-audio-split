import type { FileRecord } from './file';
import type { NodeType } from './workflow';
import type { WorkflowExecutionStatus } from './execution';

export type ResultTrackState = 'Ready' | 'Pending' | 'Failed' | 'Cancelled' | 'Missing';

export interface ResultTrack {
  id: string;
  workflowNodeId: string;
  outputName: string;
  displayName: string;
  origin: 'Kept' | 'Default' | 'Manual';
  sortOrder: number;
  state: ResultTrackState;
  artifactPath?: string;
  errorMessage?: string;
  nodeLabel: string;
  nodeType: NodeType;
  modelName?: string;
}

export interface AvailableStem {
  workflowNodeId: string;
  outputName: string;
  displayName: string;
  nodeLabel: string;
  artifactPath: string;
}

export interface ExecutionResults {
  executionId: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowExecutionStatus;
  inputFile: FileRecord;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  keepMode: 'Explicit' | 'Default';
  tracks: ResultTrack[];
  available: AvailableStem[];
}
