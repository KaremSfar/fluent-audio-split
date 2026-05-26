import type { Meta, StoryObj } from '@storybook/react';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';

const meta: Meta<typeof AppHeader> = {
  title: 'Layout/AppHeader',
  component: AppHeader,
};

export default meta;
type Story = StoryObj<typeof AppHeader>;

export const Default: Story = {
  args: {},
};

export const WithBackButton: Story = {
  args: {
    onLogoClick: () => console.log('Logo clicked'),
    children: (
      <Button variant="outline" size="sm">
        ← Back
      </Button>
    ),
  },
};

export const WithUserInfo: Story = {
  args: {
    children: (
      <>
        <span className="text-sm text-muted-foreground">user@example.com</span>
        <Button variant="outline" size="sm">
          Sign out
        </Button>
      </>
    ),
  },
};
