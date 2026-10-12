import apiClient from './apiClient';
import type { ExecutionResults, ResultTrack } from '../types/results';

export const resultsService = {
  get: async (executionId: string): Promise<ExecutionResults> => {
    const { data } = await apiClient.get<ExecutionResults>(`/executions/${executionId}/results`);
    return data;
  },
  addTrack: async (
    executionId: string,
    body: { workflowNodeId: string; outputName: string },
  ): Promise<ResultTrack> => {
    const { data } = await apiClient.post<ResultTrack>(`/executions/${executionId}/results/tracks`, body);
    return data;
  },
  removeTrack: async (executionId: string, trackId: string): Promise<void> => {
    await apiClient.delete(`/executions/${executionId}/results/tracks/${trackId}`);
  },
};
