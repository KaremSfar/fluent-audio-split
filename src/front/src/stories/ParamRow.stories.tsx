import type { Meta, StoryObj } from '@storybook/react';
import { ParamRow } from '@/components/workflow/ParamRow';

const fn = () => () => {};
import type { ParamDef } from '@/lib/advancedParams';

const meta: Meta<typeof ParamRow> = {
  title: 'Workflow/ParamRow',
  component: ParamRow,
  decorators: [
    (Story) => (
      <div className="p-4 max-w-md">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ParamRow>;

const booleanParam: ParamDef = {
  key: 'invert_using_spec',
  label: 'Invert via Spectrogram',
  description: 'Invert secondary stem using spectrogram subtraction instead of waveform subtraction (default: false).',
  type: 'boolean',
  default: false,
};

const selectParam: ParamDef = {
  key: 'output_format',
  label: 'Output Format',
  description: 'Output format for separated files (default: FLAC).',
  type: 'select',
  default: 'FLAC',
  options: [
    { value: 'FLAC', label: 'FLAC' },
    { value: 'WAV', label: 'WAV' },
    { value: 'MP3', label: 'MP3' },
    { value: 'M4A', label: 'M4A' },
    { value: 'OGG', label: 'OGG' },
  ],
};

const numberParam: ParamDef = {
  key: 'normalization_threshold',
  label: 'Normalization',
  description: 'Max peak amplitude to normalize input and output audio to (default: 0.9). Example: 0.7',
  type: 'number',
  default: 0.9,
  min: 0,
  max: 1,
  step: 0.05,
};

const textParam: ParamDef = {
  key: 'demucs_segment_size',
  label: 'Segment Size',
  description: 'Size of segments for Demucs processing. Can be "Default" or a number.',
  type: 'text',
  default: 'Default',
};

export const BooleanParam: Story = {
  args: {
    def: booleanParam,
    value: false,
    onChange: fn(),
  },
};

export const SelectParam: Story = {
  args: {
    def: selectParam,
    value: 'FLAC',
    onChange: fn(),
  },
};

export const NumberParam: Story = {
  args: {
    def: numberParam,
    value: 0.9,
    onChange: fn(),
  },
};

export const TextParam: Story = {
  args: {
    def: textParam,
    value: 'Default',
    onChange: fn(),
  },
};
