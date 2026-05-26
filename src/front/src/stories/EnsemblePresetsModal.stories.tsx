import type { Meta, StoryObj } from '@storybook/react';
import { EnsemblePresetsModal } from '@/components/workflow/EnsemblePresetsModal';

const fn = () => () => {};

const meta: Meta<typeof EnsemblePresetsModal> = {
  title: 'Workflow/EnsemblePresetsModal',
  component: EnsemblePresetsModal,
};

export default meta;
type Story = StoryObj<typeof EnsemblePresetsModal>;

export const Default: Story = {
  args: {
    onApply: fn(),
    onClose: fn(),
  },
};
