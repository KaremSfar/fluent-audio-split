export type EnsembleMethod =
  | 'avg_wave' | 'median_wave' | 'min_wave' | 'max_wave'
  | 'avg_fft'  | 'median_fft'  | 'min_fft'  | 'max_fft'
  | 'uvr_max_spec' | 'uvr_min_spec' | 'ensemble_wav';

export const ENSEMBLE_ALGORITHMS: { value: EnsembleMethod; label: string; group: string }[] = [
  { value: 'avg_wave',     label: 'Avg Wave — weighted average of waveforms (default)', group: 'Waveform' },
  { value: 'median_wave',  label: 'Median Wave',                                        group: 'Waveform' },
  { value: 'min_wave',     label: 'Min Wave',                                           group: 'Waveform' },
  { value: 'max_wave',     label: 'Max Wave',                                           group: 'Waveform' },
  { value: 'avg_fft',      label: 'Avg FFT — weighted average of spectrograms',         group: 'Spectrogram' },
  { value: 'median_fft',   label: 'Median FFT',                                         group: 'Spectrogram' },
  { value: 'min_fft',      label: 'Min FFT',                                            group: 'Spectrogram' },
  { value: 'max_fft',      label: 'Max FFT',                                            group: 'Spectrogram' },
  { value: 'uvr_max_spec', label: 'UVR Max Spec',                                       group: 'UVR' },
  { value: 'uvr_min_spec', label: 'UVR Min Spec',                                       group: 'UVR' },
  { value: 'ensemble_wav', label: 'Ensemble Wav — least noisy chunk (UVR)',             group: 'UVR' },
];

export interface ModelDefinition {
  value: string;
  label: string;
  stems: string[];
  category: 'splitter' | 'debleed' | 'denoise';
  arch: import('./advancedParams').ModelArch;
}

export const MODEL_DEFINITIONS: ModelDefinition[] = [
  // ── Demucs v4 splitters ────────────────────────────────────────────────────
  { value: 'htdemucs_ft.yaml',  label: 'htdemucs_ft — 4-stem fine-tuned (recommended)',        stems: ['Vocals', 'Drums', 'Bass', 'Other'],                  category: 'splitter', arch: 'demucs' },
  { value: 'htdemucs.yaml',     label: 'htdemucs — 4-stem hybrid transformer',                  stems: ['Vocals', 'Drums', 'Bass', 'Other'],                  category: 'splitter', arch: 'demucs' },
  { value: 'htdemucs_6s.yaml',  label: 'htdemucs_6s — 6-stem: guitar & piano ★ metal',         stems: ['Vocals', 'Drums', 'Bass', 'Other', 'Guitar', 'Piano'], category: 'splitter', arch: 'demucs' },
  // ── MDX-Net splitters ──────────────────────────────────────────────────────
  { value: 'UVR-MDX-NET-Inst_HQ_3.onnx', label: 'UVR-MDX-NET-Inst HQ 3 — inst/vocals (MDX)',  stems: ['Vocals', 'Instrumental'],                            category: 'splitter', arch: 'mdx' },
  // ── Roformer splitters ─────────────────────────────────────────────────────
  { value: 'vocals_mel_band_roformer.ckpt',     label: 'MelBand Roformer | Vocals (Kimberley Jensen)',          stems: ['Vocals', 'Other'],         category: 'splitter',  arch: 'mdxc' },
  { value: 'melband_roformer_inst_v2.ckpt',     label: 'MelBand Roformer Kim | Inst V2 — vocals/inst ★ SDR 16.1', stems: ['Vocals', 'Instrumental'], category: 'splitter',  arch: 'mdxc' },
  // ── Debleed ───────────────────────────────────────────────────────────────
  { value: 'mel_band_roformer_bleed_suppressor_v1.ckpt',      label: 'MelBand Roformer | Bleed Suppressor V1 ★ debleed',  stems: ['Instrumental', 'Bleed'], category: 'debleed', arch: 'mdxc' },
  // ── Denoise ───────────────────────────────────────────────────────────────
  { value: 'denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt', label: 'Mel-Roformer-Denoise-Aufr33 ★ denoise SDR 27.99', stems: ['Dry', 'Other'],           category: 'denoise', arch: 'mdxc' },
];

export function getStemsForModel(modelName: string): string[] {
  return MODEL_DEFINITIONS.find(m => m.value === modelName)?.stems ?? ['Vocals', 'Instrumental'];
}

export const STEM_COLORS: Record<string, string> = {
  Vocals: 'bg-rose-400',
  Drums: 'bg-amber-400',
  Bass: 'bg-emerald-400',
  Other: 'bg-slate-400',
  Guitar: 'bg-orange-400',
  Piano: 'bg-sky-400',
  Instrumental: 'bg-indigo-400',
  Bleed: 'bg-red-300',
  Dry: 'bg-teal-400',
};
