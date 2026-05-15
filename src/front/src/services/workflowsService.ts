import apiClient from './apiClient';
import type { Workflow, CreateWorkflowRequest, UpdateWorkflowRequest } from '../types/workflow';

export const workflowsService = {
  create: async (req: CreateWorkflowRequest): Promise<Workflow> => {
    const { data } = await apiClient.post<Workflow>('/workflows', req);
    return data;
  },
  update: async (id: string, req: UpdateWorkflowRequest): Promise<Workflow> => {
    const { data } = await apiClient.patch<Workflow>(`/workflows/${id}`, req);
    return data;
  },
  list: async (): Promise<Workflow[]> => {
    const { data } = await apiClient.get<Workflow[]>('/workflows');
    return data;
  },
  get: async (id: string): Promise<Workflow> => {
    const { data } = await apiClient.get<Workflow>(`/workflows/${id}`);
    return data;
  },
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/workflows/${id}`);
  },
};
