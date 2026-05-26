import type { Meta, StoryObj } from '@storybook/react';
import { Tooltip } from '@/components/workflow/Tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Workflow/Tooltip',
  component: Tooltip,
  decorators: [
    (Story) => (
      <div className="p-8">
        <span>Hover over the icon: </span>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  args: {
    text: 'This is a helpful tooltip with information about the feature. It can contain multiple lines of text.',
  },
};
