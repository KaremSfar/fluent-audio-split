import type { Meta, StoryObj } from '@storybook/react';
import { NodeExecutionCard } from '@/components/execution/NodeExecutionCard';
import type { NodeExecution } from '@/types/execution';
import type { WorkflowNode } from '@/types/workflow';

const meta = {
  title: 'Execution/NodeExecutionCard',
  component: NodeExecutionCard,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NodeExecutionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockWorkflowNode: WorkflowNode = {
  id: 'wn-1',
  order: 0,
  nodeType: 'AudioSeparation',
  configJson: '{"modelName":"htdemucs_ft.yaml"}',
  sourceNodeId: null,
  sourceOutputName: null,
};

const pendingNode: NodeExecution = {
  id: 'ne-1',
  workflowNodeId: 'wn-1',
  attempt: 1,
  status: 'Pending',
  outputArtifactPaths: {},
};

const runningNode: NodeExecution = {
  id: 'ne-2',
  workflowNodeId: 'wn-1',
  attempt: 1,
  status: 'Running',
  outputArtifactPaths: {},
  startedAt: '2024-01-15T10:30:00Z',
};

const completedNode: NodeExecution = {
  id: 'ne-3',
  workflowNodeId: 'wn-1',
  attempt: 1,
  status: 'Completed',
  outputArtifactPaths: {
    vocals: 'output/vocals.wav',
    instrumental: 'output/instrumental.wav',
    bass: 'output/bass.wav',
    drums: 'output/drums.wav',
  },
  startedAt: '2024-01-15T10:30:00Z',
  completedAt: '2024-01-15T10:30:45Z',
};

const failedNode: NodeExecution = {
  id: 'ne-4',
  workflowNodeId: 'wn-1',
  attempt: 2,
  status: 'Failed',
  outputArtifactPaths: {},
  errorMessage: 'CUDA out of memory. Tried to allocate 2.00 GiB (GPU 0; 11.91 GiB total capacity)',
  startedAt: '2024-01-15T10:31:00Z',
  completedAt: '2024-01-15T10:31:05Z',
};

export const Pending: Story = {
  args: {
    node: pendingNode,
    workflowNode: mockWorkflowNode,
    onRetry: () => console.log('Retry clicked'),
    onDownload: (path: string) => console.log('Download:', path),
    isRetrying: false,
  },
};

export const Running: Story = {
  args: {
    node: runningNode,
    workflowNode: mockWorkflowNode,
    onRetry: () => console.log('Retry clicked'),
    onDownload: (path: string) => console.log('Download:', path),
    isRetrying: false,
  },
};

export const Completed: Story = {
  args: {
    node: completedNode,
    workflowNode: mockWorkflowNode,
    onRetry: () => console.log('Retry clicked'),
    onDownload: (path: string) => console.log('Download:', path),
    isRetrying: false,
  },
};

export const Failed: Story = {
  args: {
    node: failedNode,
    workflowNode: mockWorkflowNode,
    onRetry: () => console.log('Retry clicked'),
    onDownload: (path: string) => console.log('Download:', path),
    isRetrying: false,
  },
};

export const FailedRetrying: Story = {
  args: {
    node: failedNode,
    workflowNode: mockWorkflowNode,
    onRetry: () => console.log('Retry clicked'),
    onDownload: (path: string) => console.log('Download:', path),
    isRetrying: true,
  },
};
