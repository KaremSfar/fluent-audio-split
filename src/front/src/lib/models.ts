export type EnsembleMethod = 'avg' | 'median';

export interface ModelDefinition {
  value: string;
  label: string;
  stems: string[];
  category: 'splitter' | 'debleed' | 'denoise';
}

export const MODEL_DEFINITIONS: ModelDefinition[] = [
  // ── Demucs v4 splitters ────────────────────────────────────────────────────
  { value: 'htdemucs_ft.yaml', label: 'htdemucs_ft — 4-stem fine-tuned (recommended)', stems: ['Vocals', 'Drums', 'Bass', 'Other'], category: 'splitter' },
  { value: 'htdemucs.yaml', label: 'htdemucs — 4-stem hybrid transformer', stems: ['Vocals', 'Drums', 'Bass', 'Other'], category: 'splitter' },
  { value: 'htdemucs_6s.yaml', label: 'htdemucs_6s — 6-stem: guitar & piano ★ metal', stems: ['Vocals', 'Drums', 'Bass', 'Other', 'Guitar', 'Piano'], category: 'splitter' },
  // ── MDX-Net splitters ──────────────────────────────────────────────────────
  { value: 'UVR-MDX-NET-Inst_HQ_3.onnx', label: 'UVR-MDX-NET-Inst HQ 3 — inst/vocals (MDX)', stems: ['Vocals', 'Instrumental'], category: 'splitter' },
  // ── Roformer splitters ─────────────────────────────────────────────────────
  { value: 'vocals_mel_band_roformer.ckpt', label: 'MelBand Roformer | Vocals (Kimberley Jensen)', stems: ['Vocals', 'Other'], category: 'splitter' },
  { value: 'melband_roformer_inst_v2.ckpt', label: 'MelBand Roformer Kim | Inst V2 — vocals/inst ★ SDR 16.1', stems: ['Vocals', 'Instrumental'], category: 'splitter' },
  // ── Debleed ───────────────────────────────────────────────────────────────
  { value: 'mel_band_roformer_bleed_suppressor_v1.ckpt', label: 'MelBand Roformer | Bleed Suppressor V1 ★ debleed', stems: ['Instrumental', 'Bleed'], category: 'debleed' },
  // ── Denoise ───────────────────────────────────────────────────────────────
  { value: 'denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt', label: 'Mel-Roformer-Denoise-Aufr33 ★ denoise SDR 27.99', stems: ['Dry', 'Other'], category: 'denoise' },
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
