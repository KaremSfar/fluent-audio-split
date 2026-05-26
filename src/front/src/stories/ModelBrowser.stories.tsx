import type { Meta, StoryObj } from '@storybook/react';
import { ModelBrowser } from '@/components/workflow/ModelBrowser';

const fn = () => () => {};

const meta: Meta<typeof ModelBrowser> = {
  title: 'Workflow/ModelBrowser',
  component: ModelBrowser,
  decorators: [
    (Story) => (
      <div className="w-96 border-l bg-background">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ModelBrowser>;

export const Default: Story = {
  args: {
    selectedModel: '',
    onSelectModel: fn(),
    onOpenAdvanced: fn(),
  },
};

export const WithSelection: Story = {
  args: {
    selectedModel: 'htdemucs_ft.yaml',
    onSelectModel: fn(),
    onOpenAdvanced: fn(),
  },
};
