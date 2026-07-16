import modelRegistryRaw from './model_registry.json';

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

export type ModelCategory =
  | 'splitter'   // vocals/instrumental separation
  | 'multistem'  // 4+ stem separation
  | 'karaoke'    // karaoke / lead vocal removal
  | 'denoise'    // noise reduction
  | 'dereverb'   // reverb / echo removal
  | 'debleed'    // bleed suppression
  | 'drums'      // drum separation
  | 'specialty'; // other specialized models

export const CATEGORY_LABELS: Record<ModelCategory, string> = {
  splitter:  'Vocal / Instrumental Splitter',
  multistem: 'Multi-Stem (4–6 Stems)',
  karaoke:   'Karaoke / Lead Vocal Removal',
  denoise:   'Denoise',
  dereverb:  'De-Reverb / De-Echo',
  debleed:   'Debleed',
  drums:     'Drum Separation',
  specialty: 'Specialty',
};

export interface ModelDefinition {
  value: string;
  label: string;
  stems: string[];
  category: ModelCategory;
  arch: import('./advancedParams').ModelArch;
}

// ── Model registry (single source of truth) ──────────────────────────────────
// model_registry.json is generated offline (see ~/Repos/audio-sep/build_model_registry.py)
// by actually downloading each model and resolving its real SDK-internal stem names
// against the declared stems in models.ts's old MODEL_DEFINITIONS. It is the same file
// consumed by the worker (src/audio-separation-worker/app/model_registry.py) — copy it
// here again whenever it's rebuilt so front and worker never drift apart.
interface ModelRegistryEntry {
  arch: import('./advancedParams').ModelArch;
  category: ModelCategory;
  label: string;
  status: 'ok' | 'error';
  stems: string[];
  stem_map?: Record<string, string>;
  real_stems?: string[];
  error?: string;
}

const MODEL_REGISTRY = modelRegistryRaw as Record<string, ModelRegistryEntry>;

// Only models with status "ok" are exposed — their declared stems have been
// unambiguously matched against the real audio-separator SDK output, so the
// worker is guaranteed to produce exactly these named outputs. Models with
// status "error" (declared/real stem mismatch, unresolvable hash, etc.) are
// excluded entirely rather than shown as broken options — see model_registry.json
// for the full list of excluded models and why.
export const MODEL_DEFINITIONS: ModelDefinition[] = Object.entries(MODEL_REGISTRY)
  .filter(([, entry]) => entry.status === 'ok')
  .map(([value, entry]) => ({
    value,
    label: entry.label,
    stems: entry.stems,
    category: entry.category,
    arch: entry.arch,
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function getStemsForModel(modelName: string): string[] {
  return MODEL_REGISTRY[modelName]?.stems ?? ['Vocals', 'Instrumental'];
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
  'No Reverb': 'bg-cyan-400',
  Reverb: 'bg-blue-300',
  'No Echo': 'bg-lime-400',
  Echo: 'bg-yellow-300',
  Noise: 'bg-orange-300',
  'No Noise': 'bg-green-300',
  Kick: 'bg-red-400',
  Snare: 'bg-orange-400',
  Toms: 'bg-yellow-400',
  HH: 'bg-lime-400',
  Ride: 'bg-emerald-300',
  Crash: 'bg-teal-300',
  Male: 'bg-blue-400',
  Female: 'bg-pink-400',
  Crowd: 'bg-purple-300',
  Aspiration: 'bg-sky-300',
  'No Dry': 'bg-slate-300',
  'No Crowd': 'bg-violet-300',
  'No Woodwinds': 'bg-green-400',
  Woodwinds: 'bg-emerald-300',
  'No Other': 'bg-slate-300',
  'No Bass': 'bg-emerald-200',
  'No Drums': 'bg-amber-200',
  'Drum-Bass': 'bg-red-300',
  'No Drum-Bass': 'bg-slate-300',
};

// ── Ensemble presets ──────────────────────────────────────────────────────────
export interface EnsemblePreset {
  id: string;
  name: string;
  description: string;
  models: string[];
  algorithm: EnsembleMethod;
  contributor: string;
}

// Community presets were removed pending re-validation against model_registry.json
// (several referenced models with declared/real stem mismatches that are now excluded
// from MODEL_DEFINITIONS). Add your own presets here as needed.
export const ENSEMBLE_PRESETS: EnsemblePreset[] = [];
