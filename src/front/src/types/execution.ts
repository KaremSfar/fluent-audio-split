export type WorkflowExecutionStatus = 'Pending' | 'Running' | 'Completed' | 'PartiallyFailed' | 'Failed' | 'Cancelled';
export type NodeExecutionStatus = 'Pending' | 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';

export interface NodeExecution {
  id: string;
  workflowNodeId: string;
  attempt: number;
  status: NodeExecutionStatus;
  outputArtifactDir?: string;
  outputArtifactPaths: Record<string, string>;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  // Resolved server-side from the version the execution ran against, so the label survives
  // later edits to the workflow (which mint new node ids in a new version).
  nodeLabel?: string;
  modelName?: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  workflowName: string;
  inputFile: import('./file').FileRecord;
  status: WorkflowExecutionStatus;
  nodeExecutions: NodeExecution[];
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
}

export interface NodeStatusEvent {
  nodeExecutionId: string;
  // Present on backend SSE events so the client can place an update on the right workflow
  // node even for a node execution id it has never seen (lazily-created downstream / retry).
  workflowNodeId?: string;
  status: NodeExecutionStatus;
  attempt?: number;
  outputPaths?: Record<string, string>;
  errorMessage?: string;
}

export interface ExecutionStatusEvent {
  status: WorkflowExecutionStatus;
  errorMessage?: string;
}
