import type { Meta, StoryObj } from '@storybook/react';
import { StatusBadge } from '@/components/execution/StatusBadge';

const meta = {
  title: 'Execution/StatusBadge',
  component: StatusBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = {
  args: {
    status: 'Completed',
  },
};

export const Running: Story = {
  args: {
    status: 'Running',
  },
};

export const Failed: Story = {
  args: {
    status: 'Failed',
  },
};

export const PartiallyFailed: Story = {
  args: {
    status: 'PartiallyFailed',
  },
};

export const Pending: Story = {
  args: {
    status: 'Pending',
  },
};

export const Queued: Story = {
  args: {
    status: 'Queued',
  },
};

export const Cancelled: Story = {
  args: {
    status: 'Cancelled',
  },
};
