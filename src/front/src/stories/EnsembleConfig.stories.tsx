import type { Meta, StoryObj } from '@storybook/react';
import { EnsembleConfig } from '@/components/workflow/EnsembleConfig';

const fn = () => () => {};

const meta: Meta<typeof EnsembleConfig> = {
  title: 'Workflow/EnsembleConfig',
  component: EnsembleConfig,
  decorators: [
    (Story) => (
      <div className="w-96 border-t bg-background p-3">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof EnsembleConfig>;

export const Disabled: Story = {
  args: {
    enabled: false,
    method: 'avg_wave',
    primaryModelLabel: 'htdemucs_ft — 4-stem FT (recommended)',
    ensembleModels: [],
    compatibleModels: [],
    onToggle: fn(),
    onMethodChange: fn(),
    onAddModel: fn(),
    onRemoveModel: fn(),
    onOpenPresets: fn(),
  },
};

export const EnabledEmpty: Story = {
  args: {
    enabled: true,
    method: 'avg_wave',
    primaryModelLabel: 'htdemucs_ft — 4-stem FT (recommended)',
    ensembleModels: [],
    compatibleModels: [
      { value: 'htdemucs.yaml', label: 'htdemucs — 4-stem hybrid transformer' },
      { value: 'hdemucs_mmi.yaml', label: 'hdemucs_mmi — 4-stem MMI' },
      { value: 'htdemucs_6s.yaml', label: 'htdemucs_6s — 6-stem: guitar & piano' },
    ],
    onToggle: fn(),
    onMethodChange: fn(),
    onAddModel: fn(),
    onRemoveModel: fn(),
    onOpenPresets: fn(),
  },
};

export const EnabledWithModels: Story = {
  args: {
    enabled: true,
    method: 'uvr_max_spec',
    primaryModelLabel: 'BS-Roformer-Viperx-1297',
    ensembleModels: [
      { value: 'model_bs_roformer_ep_368_sdr_12.9628.ckpt', label: 'BS-Roformer-Viperx-1296' },
      { value: 'MDX23C-8KFFT-InstVoc_HQ.ckpt', label: 'MDX23C: MDX23C-InstVoc HQ' },
    ],
    compatibleModels: [
      { value: 'MDX23C_D1581.ckpt', label: 'MDX23C VIP: MDX23C_D1581' },
      { value: 'model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt', label: 'Mel-Roformer-Viperx-1143' },
    ],
    onToggle: fn(),
    onMethodChange: fn(),
    onAddModel: fn(),
    onRemoveModel: fn(),
    onOpenPresets: fn(),
  },
};
