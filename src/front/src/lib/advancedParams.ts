export type ModelArch = 'demucs' | 'mdx' | 'vr' | 'mdxc';

export type ParamInputType = 'number' | 'boolean' | 'select' | 'text';

export interface ParamDef {
  key: string;
  label: string;
  description: string;
  type: ParamInputType;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export interface ParamGroup {
  title: string;
  arch: ModelArch | 'common';
  params: ParamDef[];
}

export const PARAM_GROUPS: ParamGroup[] = [
  {
    title: 'Common',
    arch: 'common',
    params: [
      {
        key: 'output_format',
        label: 'Output Format',
        description: 'Output format for separated files (default: MP3).',
        type: 'select',
        default: 'MP3',
        options: [
          { value: 'FLAC', label: 'FLAC' },
          { value: 'WAV', label: 'WAV' },
          { value: 'MP3', label: 'MP3' },
          { value: 'M4A', label: 'M4A' },
          { value: 'OGG', label: 'OGG' },
        ],
      },
      {
        key: 'normalization_threshold',
        label: 'Normalization',
        description: 'Max peak amplitude to normalize input and output audio to (default: 0.9). Example: 0.7',
        type: 'number',
        default: 0.9,
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        key: 'amplification_threshold',
        label: 'Amplification',
        description: 'Min peak amplitude to amplify input and output audio to (default: 0.0). Example: 0.4',
        type: 'number',
        default: 0.0,
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        key: 'invert_using_spec',
        label: 'Invert via Spectrogram',
        description: 'Invert secondary stem using spectrogram subtraction instead of waveform subtraction (default: false).',
        type: 'boolean',
        default: false,
      },
      {
        key: 'sample_rate',
        label: 'Sample Rate',
        description: 'Modify the sample rate of the output audio (default: 44100). Example: 48000',
        type: 'number',
        default: 44100,
        min: 8000,
        max: 96000,
        step: 100,
      },
      {
        key: 'use_soundfile',
        label: 'Use Soundfile',
        description: 'Use soundfile library to write audio output — can help avoid OOM on long files (default: false).',
        type: 'boolean',
        default: false,
      },
      {
        key: 'use_autocast',
        label: 'Use Autocast',
        description: 'Use PyTorch autocast for faster inference. Do NOT enable for CPU inference (default: false).',
        type: 'boolean',
        default: false,
      },
    ],
  },
  {
    title: 'MDX Architecture',
    arch: 'mdx',
    params: [
      {
        key: 'mdx_segment_size',
        label: 'Segment Size',
        description: 'Larger values consume more resources but may give better results (default: 256).',
        type: 'number',
        default: 256,
        min: 32,
        max: 4096,
        step: 32,
      },
      {
        key: 'mdx_overlap',
        label: 'Overlap',
        description: 'Amount of overlap between prediction windows, 0.001–0.999. Higher is better but slower (default: 0.25).',
        type: 'number',
        default: 0.25,
        min: 0.001,
        max: 0.999,
        step: 0.05,
      },
      {
        key: 'mdx_batch_size',
        label: 'Batch Size',
        description: 'Larger values consume more RAM but may process slightly faster (default: 1).',
        type: 'number',
        default: 1,
        min: 1,
        max: 64,
        step: 1,
      },
      {
        key: 'mdx_hop_length',
        label: 'Hop Length',
        description: 'Usually called stride in neural networks — only change if you know what you\'re doing (default: 1024).',
        type: 'number',
        default: 1024,
        min: 256,
        max: 4096,
        step: 256,
      },
      {
        key: 'mdx_enable_denoise',
        label: 'Enable Denoise',
        description: 'Enable denoising during separation (default: false).',
        type: 'boolean',
        default: false,
      },
    ],
  },
  {
    title: 'VR Architecture',
    arch: 'vr',
    params: [
      {
        key: 'vr_batch_size',
        label: 'Batch Size',
        description: 'Number of batches to process at a time. Higher = more RAM, slightly faster processing (default: 1).',
        type: 'number',
        default: 1,
        min: 1,
        max: 64,
        step: 1,
      },
      {
        key: 'vr_window_size',
        label: 'Window Size',
        description: 'Balance quality and speed. 1024 = fast but lower quality, 320 = slower but better quality (default: 512).',
        type: 'number',
        default: 512,
        min: 32,
        max: 2048,
        step: 32,
      },
      {
        key: 'vr_aggression',
        label: 'Aggression',
        description: 'Intensity of primary stem extraction, –100 to 100. Typically 5 for vocals & instrumentals (default: 5).',
        type: 'number',
        default: 5,
        min: -100,
        max: 100,
        step: 1,
      },
      {
        key: 'vr_enable_tta',
        label: 'Enable TTA',
        description: 'Enable Test-Time-Augmentation — slow but improves quality (default: false).',
        type: 'boolean',
        default: false,
      },
      {
        key: 'vr_high_end_process',
        label: 'High-End Process',
        description: 'Mirror the missing high-frequency range of the output (default: false).',
        type: 'boolean',
        default: false,
      },
      {
        key: 'vr_enable_post_process',
        label: 'Post Process',
        description: 'Identify leftover artifacts within vocal output; may improve separation for some songs (default: false).',
        type: 'boolean',
        default: false,
      },
      {
        key: 'vr_post_process_threshold',
        label: 'Post Process Threshold',
        description: 'Threshold for the post-process feature: 0.1–0.3 (default: 0.2). Example: 0.1',
        type: 'number',
        default: 0.2,
        min: 0.1,
        max: 0.3,
        step: 0.05,
      },
    ],
  },
  {
    title: 'Demucs Architecture',
    arch: 'demucs',
    params: [
      {
        key: 'demucs_segment_size',
        label: 'Segment Size',
        description: 'Size of segments into which audio is split, 1–100. Higher = slower but better quality (default: Default). Example: 256',
        type: 'text',
        default: 'Default',
      },
      {
        key: 'demucs_shifts',
        label: 'Shifts',
        description: 'Number of predictions with random shifts — higher = slower but better quality (default: 2).',
        type: 'number',
        default: 2,
        min: 0,
        max: 20,
        step: 1,
      },
      {
        key: 'demucs_overlap',
        label: 'Overlap',
        description: 'Overlap between prediction windows, 0.001–0.999. Higher = slower but better quality (default: 0.25).',
        type: 'number',
        default: 0.25,
        min: 0.001,
        max: 0.999,
        step: 0.05,
      },
      {
        key: 'demucs_segments_enabled',
        label: 'Segments Enabled',
        description: 'Enable segment-wise processing (default: true). Example: --demucs_segments_enabled=False',
        type: 'boolean',
        default: true,
      },
    ],
  },
  {
    title: 'MDXC Architecture',
    arch: 'mdxc',
    params: [
      {
        key: 'mdxc_segment_size',
        label: 'Segment Size',
        description: 'Larger values consume more resources but may give better results (default: 256).',
        type: 'number',
        default: 256,
        min: 32,
        max: 4096,
        step: 32,
      },
      {
        key: 'mdxc_override_model_segment_size',
        label: 'Override Model Segment Size',
        description: 'Override the model default segment size instead of using the model default value.',
        type: 'boolean',
        default: false,
      },
      {
        key: 'mdxc_overlap',
        label: 'Overlap',
        description: 'Amount of overlap between prediction windows, 2–50. Higher is better but slower (default: 8).',
        type: 'number',
        default: 8,
        min: 2,
        max: 50,
        step: 1,
      },
      {
        key: 'mdxc_batch_size',
        label: 'Batch Size',
        description: 'Larger values consume more RAM but may process slightly faster (default: 1).',
        type: 'number',
        default: 1,
        min: 1,
        max: 64,
        step: 1,
      },
      {
        key: 'mdxc_pitch_shift',
        label: 'Pitch Shift',
        description: 'Shift audio pitch by a number of semitones while processing. May improve output for deep/high vocals (default: 0).',
        type: 'number',
        default: 0,
        min: -24,
        max: 24,
        step: 1,
      },
    ],
  },
];

export function getParamGroupsForArch(arch: ModelArch): ParamGroup[] {
  const allowed = new Set<ModelArch | 'common'>(['common', arch]);
  return PARAM_GROUPS.filter((g) => allowed.has(g.arch));
}

export function getDefaultAdvancedParams(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const group of PARAM_GROUPS) {
    for (const param of group.params) {
      defaults[param.key] = param.default;
    }
  }
  return defaults;
}
