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

export const MODEL_DEFINITIONS: ModelDefinition[] = [
  // ── Demucs v4 ─────────────────────────────────────────────────────────────
  { value: 'htdemucs_ft.yaml',   label: 'htdemucs_ft — 4-stem FT (recommended)',           stems: ['Vocals', 'Drums', 'Bass', 'Other'],                     category: 'multistem', arch: 'demucs' },
  { value: 'htdemucs.yaml',      label: 'htdemucs — 4-stem hybrid transformer',             stems: ['Vocals', 'Drums', 'Bass', 'Other'],                     category: 'multistem', arch: 'demucs' },
  { value: 'hdemucs_mmi.yaml',   label: 'hdemucs_mmi — 4-stem MMI',                        stems: ['Vocals', 'Drums', 'Bass', 'Other'],                     category: 'multistem', arch: 'demucs' },
  { value: 'htdemucs_6s.yaml',   label: 'htdemucs_6s — 6-stem: guitar & piano',            stems: ['Vocals', 'Drums', 'Bass', 'Guitar', 'Piano', 'Other'],  category: 'multistem', arch: 'demucs' },

  // ── VR Arch v5 splitters ──────────────────────────────────────────────────
  { value: '1_HP-UVR.pth',                  label: 'VR v5: 1_HP-UVR',                     stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '2_HP-UVR.pth',                  label: 'VR v5: 2_HP-UVR',                     stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '3_HP-Vocal-UVR.pth',            label: 'VR v5: 3_HP-Vocal-UVR',               stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'vr' },
  { value: '4_HP-Vocal-UVR.pth',            label: 'VR v5: 4_HP-Vocal-UVR',               stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'vr' },
  { value: '5_HP-Karaoke-UVR.pth',          label: 'VR v5: 5_HP-Karaoke-UVR',             stems: ['Instrumental', 'Vocals'], category: 'karaoke',  arch: 'vr' },
  { value: '6_HP-Karaoke-UVR.pth',          label: 'VR v5: 6_HP-Karaoke-UVR',             stems: ['Instrumental', 'Vocals'], category: 'karaoke',  arch: 'vr' },
  { value: '7_HP2-UVR.pth',                 label: 'VR v5: 7_HP2-UVR',                    stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '8_HP2-UVR.pth',                 label: 'VR v5: 8_HP2-UVR',                    stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '9_HP2-UVR.pth',                 label: 'VR v5: 9_HP2-UVR',                    stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '10_SP-UVR-2B-32000-1.pth',      label: 'VR v5: 10_SP-UVR-2B-32000-1',         stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '11_SP-UVR-2B-32000-2.pth',      label: 'VR v5: 11_SP-UVR-2B-32000-2',         stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '12_SP-UVR-3B-44100.pth',        label: 'VR v5: 12_SP-UVR-3B-44100',           stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '13_SP-UVR-4B-44100-1.pth',      label: 'VR v5: 13_SP-UVR-4B-44100-1',         stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '14_SP-UVR-4B-44100-2.pth',      label: 'VR v5: 14_SP-UVR-4B-44100-2',         stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '15_SP-UVR-MID-44100-1.pth',     label: 'VR v5: 15_SP-UVR-MID-44100-1',        stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '16_SP-UVR-MID-44100-2.pth',     label: 'VR v5: 16_SP-UVR-MID-44100-2',        stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: '17_HP-Wind_Inst-UVR.pth',       label: 'VR v5: 17_HP-Wind_Inst-UVR',          stems: ['No Woodwinds', 'Woodwinds'], category: 'specialty', arch: 'vr' },
  { value: 'UVR-BVE-4B_SN-44100-1.pth',     label: 'VR v5: UVR-BVE-4B_SN-44100-1',        stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'vr' },
  { value: 'UVR-BVE-4B_SN-44100-2.pth',     label: 'VR v5: UVR-BVE-4B_SN-44100-2',        stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'vr' },
  // ── VR Arch v4 splitters ──────────────────────────────────────────────────
  { value: 'MGM_HIGHEND_v4.pth',            label: 'VR v4: MGM_HIGHEND_v4',               stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: 'MGM_LOWEND_A_v4.pth',           label: 'VR v4: MGM_LOWEND_A_v4',              stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: 'MGM_LOWEND_B_v4.pth',           label: 'VR v4: MGM_LOWEND_B_v4',              stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  { value: 'MGM_MAIN_v4.pth',               label: 'VR v4: MGM_MAIN_v4',                  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'vr' },
  // ── VR Arch denoise / dereverb ────────────────────────────────────────────
  { value: 'UVR-De-Echo-Aggressive.pth',    label: 'VR: UVR-De-Echo-Aggressive',          stems: ['No Echo', 'Echo'],        category: 'dereverb', arch: 'vr' },
  { value: 'UVR-De-Echo-Normal.pth',        label: 'VR: UVR-De-Echo-Normal',              stems: ['No Echo', 'Echo'],        category: 'dereverb', arch: 'vr' },
  { value: 'UVR-DeEcho-DeReverb.pth',       label: 'VR: UVR-DeEcho-DeReverb',             stems: ['No Reverb', 'Reverb'],    category: 'dereverb', arch: 'vr' },
  { value: 'UVR-DeNoise-Lite.pth',          label: 'VR: UVR-DeNoise-Lite',                stems: ['Noise', 'No Noise'],      category: 'denoise',  arch: 'vr' },
  { value: 'UVR-DeNoise.pth',               label: 'VR: UVR-DeNoise',                     stems: ['Noise', 'No Noise'],      category: 'denoise',  arch: 'vr' },
  { value: 'UVR-De-Reverb-aufr33-jarredou.pth', label: 'VR v4: UVR-De-Reverb by aufr33-jarredou', stems: ['Dry', 'No Dry'], category: 'dereverb', arch: 'vr' },

  // ── MDX-Net splitters ─────────────────────────────────────────────────────
  { value: 'UVR-MDX-NET-Inst_HQ_1.onnx',   label: 'MDX: UVR-MDX-NET Inst HQ 1',          stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Inst_HQ_2.onnx',   label: 'MDX: UVR-MDX-NET Inst HQ 2',          stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Inst_HQ_3.onnx',   label: 'MDX: UVR-MDX-NET Inst HQ 3',          stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Inst_HQ_4.onnx',   label: 'MDX: UVR-MDX-NET Inst HQ 4',          stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Inst_HQ_5.onnx',   label: 'MDX: UVR-MDX-NET Inst HQ 5',          stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR_MDXNET_Main.onnx',          label: 'MDX: UVR-MDX-NET Main',               stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Inst_Main.onnx',    label: 'MDX: UVR-MDX-NET Inst Main',          stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR_MDXNET_1_9703.onnx',        label: 'MDX: UVR-MDX-NET 1',                  stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR_MDXNET_2_9682.onnx',        label: 'MDX: UVR-MDX-NET 2',                  stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR_MDXNET_3_9662.onnx',        label: 'MDX: UVR-MDX-NET 3',                  stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Inst_1.onnx',       label: 'MDX: UVR-MDX-NET Inst 1',             stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Inst_2.onnx',       label: 'MDX: UVR-MDX-NET Inst 2',             stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Inst_3.onnx',       label: 'MDX: UVR-MDX-NET Inst 3',             stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR_MDXNET_KARA.onnx',          label: 'MDX: UVR-MDX-NET Karaoke',            stems: ['Vocals', 'Instrumental'], category: 'karaoke',  arch: 'mdx' },
  { value: 'UVR_MDXNET_KARA_2.onnx',        label: 'MDX: UVR-MDX-NET Karaoke 2',          stems: ['Instrumental', 'Vocals'], category: 'karaoke',  arch: 'mdx' },
  { value: 'UVR_MDXNET_9482.onnx',          label: 'MDX: UVR_MDXNET_9482',                stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Voc_FT.onnx',       label: 'MDX: UVR-MDX-NET Voc FT',             stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'Kim_Vocal_1.onnx',              label: 'MDX: Kim Vocal 1',                    stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'Kim_Vocal_2.onnx',              label: 'MDX: Kim Vocal 2',                    stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'Kim_Inst.onnx',                 label: 'MDX: Kim Inst',                       stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'kuielab_a_vocals.onnx',         label: 'MDX: kuielab_a_vocals',               stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'kuielab_b_vocals.onnx',         label: 'MDX: kuielab_b_vocals',               stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  // ── MDX-Net specialty ─────────────────────────────────────────────────────
  { value: 'Reverb_HQ_By_FoxJoy.onnx',     label: 'MDX: Reverb HQ By FoxJoy',            stems: ['Reverb', 'No Reverb'],    category: 'dereverb', arch: 'mdx' },
  { value: 'UVR-MDX-NET_Crowd_HQ_1.onnx',  label: 'MDX: UVR-MDX-NET Crowd HQ 1',         stems: ['No Crowd', 'Crowd'],      category: 'specialty', arch: 'mdx' },
  { value: 'kuielab_a_other.onnx',          label: 'MDX: kuielab_a_other',                stems: ['Other', 'No Other'],      category: 'specialty', arch: 'mdx' },
  { value: 'kuielab_a_bass.onnx',           label: 'MDX: kuielab_a_bass',                 stems: ['Bass', 'No Bass'],        category: 'specialty', arch: 'mdx' },
  { value: 'kuielab_a_drums.onnx',          label: 'MDX: kuielab_a_drums',                stems: ['Drums', 'No Drums'],      category: 'drums',     arch: 'mdx' },
  { value: 'kuielab_b_other.onnx',          label: 'MDX: kuielab_b_other',                stems: ['Other', 'No Other'],      category: 'specialty', arch: 'mdx' },
  { value: 'kuielab_b_bass.onnx',           label: 'MDX: kuielab_b_bass',                 stems: ['Bass', 'No Bass'],        category: 'specialty', arch: 'mdx' },
  { value: 'kuielab_b_drums.onnx',          label: 'MDX: kuielab_b_drums',                stems: ['Drums', 'No Drums'],      category: 'drums',     arch: 'mdx' },
  // ── MDX-Net VIP splitters ─────────────────────────────────────────────────
  { value: 'UVR-MDX-NET_Main_340.onnx',     label: 'MDX VIP: UVR-MDX-NET_Main_340',       stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET_Main_390.onnx',     label: 'MDX VIP: UVR-MDX-NET_Main_390',       stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET_Main_406.onnx',     label: 'MDX VIP: UVR-MDX-NET_Main_406',       stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET_Main_427.onnx',     label: 'MDX VIP: UVR-MDX-NET_Main_427',       stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET_Main_438.onnx',     label: 'MDX VIP: UVR-MDX-NET_Main_438',       stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET_Inst_82_beta.onnx',  label: 'MDX VIP: UVR-MDX-NET_Inst_82_beta', stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET_Inst_90_beta.onnx',  label: 'MDX VIP: UVR-MDX-NET_Inst_90_beta', stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET_Inst_187_beta.onnx', label: 'MDX VIP: UVR-MDX-NET_Inst_187_beta',stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },
  { value: 'UVR-MDX-NET-Inst_full_292.onnx', label: 'MDX VIP: UVR-MDX-NET-Inst_full_292', stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdx' },

  // ── MDXC / MDX23C splitters ───────────────────────────────────────────────
  { value: 'MDX23C-8KFFT-InstVoc_HQ.ckpt',  label: 'MDX23C: MDX23C-InstVoc HQ',           stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdxc' },
  { value: 'MDX23C_D1581.ckpt',              label: 'MDX23C VIP: MDX23C_D1581',             stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdxc' },
  { value: 'MDX23C-8KFFT-InstVoc_HQ_2.ckpt', label: 'MDX23C VIP: MDX23C-InstVoc HQ 2',    stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdxc' },
  // ── MDXC / MDX23C specialty ───────────────────────────────────────────────
  { value: 'MDX23C-De-Reverb-aufr33-jarredou.ckpt', label: 'MDX23C: De-Reverb by aufr33-jarredou', stems: ['Dry', 'No Dry'],  category: 'dereverb', arch: 'mdxc' },
  { value: 'MDX23C-DrumSep-aufr33-jarredou.ckpt',   label: 'MDX23C: DrumSep by aufr33-jarredou',   stems: ['Kick', 'Snare', 'Toms', 'HH', 'Ride', 'Crash'], category: 'drums', arch: 'mdxc' },

  // ── Roformer — BS-Roformer splitters ──────────────────────────────────────
  { value: 'model_bs_roformer_ep_317_sdr_12.9755.ckpt', label: 'BS-Roformer-Viperx-1297',  stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdxc' },
  { value: 'model_bs_roformer_ep_368_sdr_12.9628.ckpt', label: 'BS-Roformer-Viperx-1296',  stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdxc' },
  { value: 'model_bs_roformer_ep_937_sdr_10.5309.ckpt', label: 'BS-Roformer-Viperx-1053 (no drum-bass)', stems: ['No Drum-Bass', 'Drum-Bass'], category: 'specialty', arch: 'mdxc' },
  { value: 'BS-Roformer-SW.ckpt',                        label: 'BS Roformer SW by jarredou',stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdxc' },
  { value: 'bs_roformer_vocals_gabox.ckpt',              label: 'BS Roformer | Vocals by Gabox',         stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'bs_roformer_vocals_revive_unwa.ckpt',        label: 'BS Roformer | Vocals Revive by Unwa',   stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'bs_roformer_vocals_revive_v2_unwa.ckpt',     label: 'BS Roformer | Vocals Revive V2 by Unwa',stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'bs_roformer_vocals_revive_v3e_unwa.ckpt',    label: 'BS Roformer | Vocals Revive V3e by Unwa',stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'bs_roformer_vocals_resurrection_unwa.ckpt',  label: 'BS Roformer | Vocals Resurrection by Unwa',      stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'bs_roformer_instrumental_resurrection_unwa.ckpt', label: 'BS Roformer | Instrumental Resurrection by Unwa', stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'bs_roformer_male_female_by_aufr33_sdr_7.2889.ckpt', label: 'BS Roformer | Male-Female by aufr33',    stems: ['Male', 'Female'], category: 'specialty', arch: 'mdxc' },
  // ── BS-Roformer chorus / dereverb ─────────────────────────────────────────
  { value: 'model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt', label: 'BS Roformer | Chorus Male-Female by Sucial', stems: ['Male', 'Female'], category: 'specialty', arch: 'mdxc' },
  { value: 'deverb_bs_roformer_8_384dim_10depth.ckpt',  label: 'BS-Roformer | De-Reverb',                        stems: ['No Reverb', 'Reverb'], category: 'dereverb', arch: 'mdxc' },

  // ── Roformer — MelBand splitters ──────────────────────────────────────────
  { value: 'model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt', label: 'Mel-Roformer-Viperx-1143',                stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_inst_v1.ckpt',              label: 'MelBand Roformer Kim | Inst V1 by Unwa',         stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_inst_v2.ckpt',              label: 'MelBand Roformer Kim | Inst V2 by Unwa',         stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_inst_v1_plus.ckpt',         label: 'MelBand Roformer Kim | Inst V1 Plus by Unwa',    stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_inst_v1e.ckpt',             label: 'MelBand Roformer Kim | Inst V1 (E) by Unwa',     stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_inst_v1e_plus.ckpt',        label: 'MelBand Roformer Kim | Inst V1 (E) Plus by Unwa',stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_instvoc_duality_v1.ckpt',   label: 'MelBand Roformer Kim | InstVoc Duality V1 by Unwa', stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_instvox_duality_v2.ckpt',   label: 'MelBand Roformer Kim | InstVoc Duality V2 by Unwa', stems: ['Vocals', 'Instrumental'], category: 'splitter', arch: 'mdxc' },
  { value: 'vocals_mel_band_roformer.ckpt',              label: 'MelBand Roformer | Vocals by Kimberley Jensen',  stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_kim_ft_unwa.ckpt',         label: 'MelBand Roformer Kim | FT by unwa',              stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_kim_ft2_unwa.ckpt',        label: 'MelBand Roformer Kim | FT 2 by unwa',            stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_kim_ft2_bleedless_unwa.ckpt', label: 'MelBand Roformer Kim | FT 2 Bleedless by unwa', stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_kim_ft3_unwa.ckpt',        label: 'MelBand Roformer Kim | FT 3 by unwa',            stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocals_becruily.ckpt',     label: 'MelBand Roformer | Vocals by becruily',          stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_becruily.ckpt', label: 'MelBand Roformer | Instrumental by becruily',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocal_fullness_aname.ckpt', label: 'MelBand Roformer | Vocals Fullness by Aname',   stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocals_gabox.ckpt',        label: 'MelBand Roformer | Vocals by Gabox',             stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocals_v2_gabox.ckpt',     label: 'MelBand Roformer | Vocals V2 by Gabox',          stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocals_fv1_gabox.ckpt',    label: 'MelBand Roformer | Vocals FV1 by Gabox',         stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocals_fv2_gabox.ckpt',    label: 'MelBand Roformer | Vocals FV2 by Gabox',         stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocals_fv3_gabox.ckpt',    label: 'MelBand Roformer | Vocals FV3 by Gabox',         stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocals_fv4_gabox.ckpt',    label: 'MelBand Roformer | Vocals FV4 by Gabox',         stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocals_fv5_gabox.ckpt',    label: 'MelBand Roformer | Vocals FV5 by Gabox',         stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_vocals_fv6_gabox.ckpt',    label: 'MelBand Roformer | Vocals FV6 by Gabox',         stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_gabox.ckpt',  label: 'MelBand Roformer | Instrumental by Gabox',       stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_2_gabox.ckpt', label: 'MelBand Roformer | Instrumental 2 by Gabox',    stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_3_gabox.ckpt', label: 'MelBand Roformer | Instrumental 3 by Gabox',    stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_bleedless_v1_gabox.ckpt', label: 'MelBand Roformer | Instrumental Bleedless V1 by Gabox', stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_bleedless_v2_gabox.ckpt', label: 'MelBand Roformer | Instrumental Bleedless V2 by Gabox', stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_bleedless_v3_gabox.ckpt', label: 'MelBand Roformer | Instrumental Bleedless V3 by Gabox', stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_fullness_v1_gabox.ckpt',  label: 'MelBand Roformer | Instrumental Fullness V1 by Gabox',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_fullness_v2_gabox.ckpt',  label: 'MelBand Roformer | Instrumental Fullness V2 by Gabox',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_fullness_v3_gabox.ckpt',  label: 'MelBand Roformer | Instrumental Fullness V3 by Gabox',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_fullness_noise_v4_gabox.ckpt', label: 'MelBand Roformer | Instrumental Fullness Noisy V4 by Gabox', stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_instv5_gabox.ckpt',  label: 'MelBand Roformer | INSTV5 by Gabox',   stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_instv5n_gabox.ckpt', label: 'MelBand Roformer | INSTV5N by Gabox',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_instv6_gabox.ckpt',  label: 'MelBand Roformer | INSTV6 by Gabox',   stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_instv6n_gabox.ckpt', label: 'MelBand Roformer | INSTV6N by Gabox',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_instv7_gabox.ckpt',  label: 'MelBand Roformer | INSTV7 by Gabox',   stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_instv7n_gabox.ckpt', label: 'MelBand Roformer | INSTV7N by Gabox',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_instv8_gabox.ckpt',  label: 'MelBand Roformer | INSTV8 by Gabox',   stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_instv8n_gabox.ckpt', label: 'MelBand Roformer | INSTV8N by Gabox',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_fv7z_gabox.ckpt',    label: 'MelBand Roformer | Instrumental FV7z by Gabox', stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_fv8_gabox.ckpt',     label: 'MelBand Roformer | Instrumental FV8 by Gabox',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  { value: 'mel_band_roformer_instrumental_fvx_gabox.ckpt',     label: 'MelBand Roformer | Instrumental FVX by Gabox',  stems: ['Instrumental', 'Vocals'], category: 'splitter', arch: 'mdxc' },
  // ── MelBand — SYHFT series ────────────────────────────────────────────────
  { value: 'MelBandRoformerSYHFT.ckpt',           label: 'MelBand Roformer Kim | SYHFT by SYH99999',         stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'MelBandRoformerSYHFTV2.ckpt',          label: 'MelBand Roformer Kim | SYHFT V2 by SYH99999',      stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'MelBandRoformerSYHFTV2.5.ckpt',        label: 'MelBand Roformer Kim | SYHFT V2.5 by SYH99999',    stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'MelBandRoformerSYHFTV3Epsilon.ckpt',   label: 'MelBand Roformer Kim | SYHFT V3 by SYH99999',      stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'MelBandRoformerBigSYHFTV1.ckpt',       label: 'MelBand Roformer Kim | Big SYHFT V1 by SYH99999',  stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  // ── MelBand — Big Beta series ─────────────────────────────────────────────
  { value: 'melband_roformer_big_beta4.ckpt',   label: 'MelBand Roformer Kim | Big Beta 4 FT by unwa',       stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_big_beta5e.ckpt',  label: 'MelBand Roformer Kim | Big Beta 5e FT by unwa',      stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_big_beta6.ckpt',   label: 'MelBand Roformer | Big Beta 6 by unwa',              stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  { value: 'melband_roformer_big_beta6x.ckpt',  label: 'MelBand Roformer | Big Beta 6X by unwa',             stems: ['Vocals', 'Other'], category: 'splitter', arch: 'mdxc' },
  // ── Roformer — Karaoke ────────────────────────────────────────────────────
  { value: 'mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt', label: 'Mel-Roformer-Karaoke-Aufr33-Viperx', stems: ['Vocals', 'Instrumental'], category: 'karaoke', arch: 'mdxc' },
  { value: 'mel_band_roformer_karaoke_gabox.ckpt',     label: 'MelBand Roformer | Karaoke by Gabox',          stems: ['Vocals', 'Instrumental'], category: 'karaoke', arch: 'mdxc' },
  { value: 'mel_band_roformer_karaoke_gabox_v2.ckpt',  label: 'MelBand Roformer | Karaoke V2 by Gabox',       stems: ['Vocals', 'Instrumental'], category: 'karaoke', arch: 'mdxc' },
  { value: 'mel_band_roformer_karaoke_becruily.ckpt',  label: 'MelBand Roformer | Karaoke by becruily',       stems: ['Vocals', 'Instrumental'], category: 'karaoke', arch: 'mdxc' },
  // ── Roformer — Denoise ────────────────────────────────────────────────────
  { value: 'denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt',   label: 'Mel-Roformer-Denoise-Aufr33',            stems: ['Dry', 'Other'], category: 'denoise', arch: 'mdxc' },
  { value: 'denoise_mel_band_roformer_aufr33_aggr_sdr_27.9768.ckpt', label: 'Mel-Roformer-Denoise-Aufr33-Aggr',   stems: ['Dry', 'Other'], category: 'denoise', arch: 'mdxc' },
  { value: 'mel_band_roformer_denoise_debleed_gabox.ckpt',         label: 'MelBand Roformer | Denoise-Debleed by Gabox', stems: ['Dry', 'Other'], category: 'denoise', arch: 'mdxc' },
  // ── Roformer — De-Reverb ──────────────────────────────────────────────────
  { value: 'dereverb_mel_band_roformer_anvuew_sdr_19.1729.ckpt',              label: 'MelBand Roformer | De-Reverb by anvuew',                    stems: ['No Reverb', 'Reverb'], category: 'dereverb', arch: 'mdxc' },
  { value: 'dereverb_mel_band_roformer_less_aggressive_anvuew_sdr_18.8050.ckpt', label: 'MelBand Roformer | De-Reverb Less Aggressive by anvuew', stems: ['No Reverb', 'Reverb'], category: 'dereverb', arch: 'mdxc' },
  { value: 'dereverb_mel_band_roformer_mono_anvuew.ckpt',          label: 'MelBand Roformer | De-Reverb Mono by anvuew',    stems: ['No Reverb', 'Reverb'], category: 'dereverb', arch: 'mdxc' },
  { value: 'dereverb_big_mbr_ep_362.ckpt',                         label: 'MelBand Roformer | De-Reverb Big by Sucial',     stems: ['No Reverb', 'Reverb'], category: 'dereverb', arch: 'mdxc' },
  { value: 'dereverb_super_big_mbr_ep_346.ckpt',                   label: 'MelBand Roformer | De-Reverb Super Big by Sucial', stems: ['No Reverb', 'Reverb'], category: 'dereverb', arch: 'mdxc' },
  { value: 'dereverb-echo_mel_band_roformer_sdr_10.0169.ckpt',     label: 'MelBand Roformer | De-Reverb-Echo by Sucial',    stems: ['Dry', 'No Dry'], category: 'dereverb', arch: 'mdxc' },
  { value: 'dereverb-echo_mel_band_roformer_sdr_13.4843_v2.ckpt',  label: 'MelBand Roformer | De-Reverb-Echo V2 by Sucial', stems: ['Dry', 'No Dry'], category: 'dereverb', arch: 'mdxc' },
  { value: 'dereverb_echo_mbr_fused.ckpt',                         label: 'MelBand Roformer | De-Reverb-Echo Fused by Sucial', stems: ['Dry', 'No Dry'], category: 'dereverb', arch: 'mdxc' },
  // ── Roformer — Specialty ──────────────────────────────────────────────────
  { value: 'mel_band_roformer_crowd_aufr33_viperx_sdr_8.7144.ckpt', label: 'Mel-Roformer-Crowd-Aufr33-Viperx',    stems: ['Crowd', 'Other'], category: 'specialty', arch: 'mdxc' },
  { value: 'aspiration_mel_band_roformer_sdr_18.9845.ckpt',         label: 'MelBand Roformer | Aspiration by Sucial',              stems: ['Aspiration', 'Other'], category: 'specialty', arch: 'mdxc' },
  { value: 'aspiration_mel_band_roformer_less_aggr_sdr_18.1201.ckpt', label: 'MelBand Roformer | Aspiration Less Aggressive by Sucial', stems: ['Aspiration', 'Other'], category: 'specialty', arch: 'mdxc' },
  // ── Roformer — Debleed ────────────────────────────────────────────────────
  { value: 'mel_band_roformer_bleed_suppressor_v1.ckpt',            label: 'MelBand Roformer | Bleed Suppressor V1 by unwa-97chris', stems: ['Instrumental', 'Bleed'], category: 'debleed', arch: 'mdxc' },
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

export const ENSEMBLE_PRESETS: EnsemblePreset[] = [
  {
    id: 'instrumental_clean',
    name: 'Instrumental Clean',
    description: 'Cleanest instrumentals with minimal vocal bleed — Fv7z (bleedless) + Resurrection Inst',
    models: ['mel_band_roformer_instrumental_fv7z_gabox.ckpt', 'bs_roformer_instrumental_resurrection_unwa.ckpt'],
    algorithm: 'uvr_max_spec',
    contributor: 'deton24 community guide',
  },
  {
    id: 'instrumental_full',
    name: 'Instrumental Full',
    description: 'Maximum instrument preservation — v1e+ (fullness) + becruily inst (SOTA SDR 17.55)',
    models: ['melband_roformer_inst_v1e_plus.ckpt', 'mel_band_roformer_instrumental_becruily.ckpt'],
    algorithm: 'uvr_max_spec',
    contributor: 'deton24 community guide',
  },
  {
    id: 'instrumental_balanced',
    name: 'Instrumental Balanced',
    description: 'Good balance of noise and fullness — Gabox INSTV8 + Resurrection Inst',
    models: ['mel_band_roformer_instrumental_instv8_gabox.ckpt', 'bs_roformer_instrumental_resurrection_unwa.ckpt'],
    algorithm: 'uvr_max_spec',
    contributor: 'deton24 community guide',
  },
  {
    id: 'instrumental_low_resource',
    name: 'Instrumental Low Resource',
    description: 'Fast ensemble for low VRAM — Resurrection Inst (200 MB) + MDX HQ_5 (ONNX, very fast)',
    models: ['bs_roformer_instrumental_resurrection_unwa.ckpt', 'UVR-MDX-NET-Inst_HQ_5.onnx'],
    algorithm: 'avg_fft',
    contributor: 'deton24 community guide',
  },
  {
    id: 'vocal_balanced',
    name: 'Vocal Balanced',
    description: 'Best overall vocal quality — Resurrection (SDR 11.34) + Beta 6X (SDR 11.12) averaged',
    models: ['bs_roformer_vocals_resurrection_unwa.ckpt', 'melband_roformer_big_beta6x.ckpt'],
    algorithm: 'avg_fft',
    contributor: 'deton24 community guide',
  },
  {
    id: 'vocal_clean',
    name: 'Vocal Clean',
    description: 'Minimal instrument bleed — Revive 2 (bleedless) + FT2 bleedless with min FFT',
    models: ['bs_roformer_vocals_revive_v2_unwa.ckpt', 'mel_band_roformer_kim_ft2_bleedless_unwa.ckpt'],
    algorithm: 'min_fft',
    contributor: 'deton24 community guide',
  },
  {
    id: 'vocal_full',
    name: 'Vocal Full',
    description: 'Maximum vocal capture including harmonies — Revive 3e + becruily vocal with max FFT',
    models: ['bs_roformer_vocals_revive_v3e_unwa.ckpt', 'mel_band_roformer_vocals_becruily.ckpt'],
    algorithm: 'max_fft',
    contributor: 'deton24 community guide',
  },
  {
    id: 'vocal_rvc',
    name: 'Vocal RVC',
    description: 'Optimized for RVC/AI voice training data — Beta 6X + Gabox voc_fv4 averaged',
    models: ['melband_roformer_big_beta6x.ckpt', 'mel_band_roformer_vocals_fv4_gabox.ckpt'],
    algorithm: 'avg_wave',
    contributor: 'deton24 community guide',
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    description: 'Lead vocal removal — 3-model karaoke ensemble reaches SDR ~10.6 vs ~10.2 single model',
    models: [
      'mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt',
      'mel_band_roformer_karaoke_gabox_v2.ckpt',
      'mel_band_roformer_karaoke_becruily.ckpt',
    ],
    algorithm: 'avg_wave',
    contributor: 'deton24 community guide',
  },
];
