import type { Meta, StoryObj } from '@storybook/react';
import { AdvancedParamsModal } from '@/components/AdvancedParamsModal';

const meta = {
  title: 'Workflow/AdvancedParamsModal',
  component: AdvancedParamsModal,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof AdvancedParamsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Demucs: Story = {
  args: {
    arch: 'demucs',
    modelLabel: 'htdemucs_ft.yaml',
    params: {},
    onChange: (key: string, val: unknown) => console.log('Changed:', key, val),
    onReset: () => console.log('Reset clicked'),
    onClose: () => console.log('Close clicked'),
  },
};

export const MDX: Story = {
  args: {
    arch: 'mdx',
    modelLabel: 'UVR-MDX-NET-Inst_HQ_3.onnx',
    params: {},
    onChange: (key: string, val: unknown) => console.log('Changed:', key, val),
    onReset: () => console.log('Reset clicked'),
    onClose: () => console.log('Close clicked'),
  },
};

export const VR: Story = {
  args: {
    arch: 'vr',
    modelLabel: 'UVR-DeNoise-Lite.pth',
    params: {},
    onChange: (key: string, val: unknown) => console.log('Changed:', key, val),
    onReset: () => console.log('Reset clicked'),
    onClose: () => console.log('Close clicked'),
  },
};

export const DemucsWithCustomParams: Story = {
  args: {
    arch: 'demucs',
    modelLabel: 'htdemucs_6s.yaml',
    params: {
      shifts: 2,
      overlap: 0.5,
      use_tta: true,
    },
    onChange: (key: string, val: unknown) => console.log('Changed:', key, val),
    onReset: () => console.log('Reset clicked'),
    onClose: () => console.log('Close clicked'),
  },
};
