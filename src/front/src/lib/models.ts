export interface ModelDefinition {
  value: string;
  label: string;
  stems: string[];
}

export const MODEL_DEFINITIONS: ModelDefinition[] = [
  { value: 'htdemucs_ft.yaml', label: 'htdemucs_ft — fine-tuned 4-stem (recommended)', stems: ['Vocals', 'Drums', 'Bass', 'Other'] },
  { value: 'htdemucs.yaml', label: 'htdemucs — 4-stem hybrid transformer', stems: ['Vocals', 'Drums', 'Bass', 'Other'] },
  { value: 'htdemucs_6s.yaml', label: 'htdemucs_6s — 6-stem (+ guitar & piano)', stems: ['Vocals', 'Drums', 'Bass', 'Other', 'Guitar', 'Piano'] },
  { value: 'UVR-MDX-NET-Inst_HQ_3.onnx', label: 'UVR-MDX-NET-Inst_HQ_3 — instrumental/vocals (MDX)', stems: ['Vocals', 'Instrumental'] },
  { value: 'vocals_mel_band_roformer.ckpt', label: 'vocals_mel_band_roformer — vocals/other (Roformer)', stems: ['Vocals', 'Other'] },
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
};
