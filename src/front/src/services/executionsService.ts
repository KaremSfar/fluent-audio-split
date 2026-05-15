import apiClient from './apiClient';
import type { WorkflowExecution, NodeExecution } from '../types/execution';

export const executionsService = {
  start: async (workflowId: string, fileId: string): Promise<WorkflowExecution> => {
    const { data } = await apiClient.post<WorkflowExecution>(`/workflows/${workflowId}/execute`, { fileId });
    return data;
  },
  list: async (): Promise<WorkflowExecution[]> => {
    const { data } = await apiClient.get<WorkflowExecution[]>('/executions');
    return data;
  },
  get: async (id: string): Promise<WorkflowExecution> => {
    const { data } = await apiClient.get<WorkflowExecution>(`/executions/${id}`);
    return data;
  },
  retry: async (executionId: string, nodeExecutionId: string): Promise<NodeExecution> => {
    const { data } = await apiClient.post<NodeExecution>(`/executions/${executionId}/nodes/${nodeExecutionId}/retry`);
    return data;
  },
  getResults: async (executionId: string): Promise<string[]> => {
    const { data } = await apiClient.get<string[]>(`/executions/${executionId}/results`);
    return data;
  },
};
