export interface WorkflowNode {
  id: string;
  order: number;
  nodeType: string;
  configJson: string;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowNodeRequest {
  order: number;
  nodeType: string;
  configJson: string;
}

export interface CreateWorkflowRequest {
  name: string;
  nodes: CreateWorkflowNodeRequest[];
}

export interface UpdateWorkflowNodeRequest {
  id?: string;
  order: number;
  nodeType: string;
  configJson: string;
}

export interface UpdateWorkflowRequest {
  name: string;
  nodes: UpdateWorkflowNodeRequest[];
}
