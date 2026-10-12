export type NodeType = 'AudioSeparation' | 'Merge';
// A Merge node always exposes exactly one output with this stable handle id; its visible
// name lives in MergeConfig.label so renaming never rewires edges.
export const MERGE_OUTPUT = 'Mix' as const;

export interface NodeInput {
  sourceNodeId: string;
  sourceOutputName: string;
}

export interface MergeConfig {
  label?: string;
  // Index-aligned with WorkflowNode.inputs; missing entries mean 0 dB.
  inputGainsDb?: number[];
  levelMode?: 'preventClipping' | 'normalizePeak' | 'none';
  ceilingDb?: number;
}

export interface WorkflowNode {
  // Client-generated GUID (also for unsaved nodes).
  id: string;
  order: number;
  nodeType: NodeType;
  configJson: string;
  // Empty for a root Split (reads the uploaded file). Merge has 2..8.
  inputs: NodeInput[];
  // Output names the user pinned as results ("Keep"). Merge may only contain 'Mix'.
  keptOutputs: string[];
}

export interface Workflow {
  id: string;
  name: string;
  // Id of the latest WorkflowVersion — compare against WorkflowExecution.workflowVersionId to
  // detect when the canvas has drifted from the version an execution actually ran against
  // (e.g. the workflow was edited+saved after the run started/finished).
  versionId: string;
  nodes: WorkflowNode[];
  createdAt: string;
  updatedAt: string;
}

export type CreateWorkflowNodeRequest = WorkflowNode;

export interface CreateWorkflowRequest {
  name: string;
  nodes: CreateWorkflowNodeRequest[];
}

export type UpdateWorkflowNodeRequest = WorkflowNode;

export interface UpdateWorkflowRequest {
  name: string;
  nodes: UpdateWorkflowNodeRequest[];
}
