"""Hardcoded model → stem definitions for audio separation models.

Keys are the exact filenames passed to separator.load_model() (including extension).
"""

MODEL_STEMS: dict[str, list[str]] = {
    # ── Demucs v4 splitters ──────────────────────────────────────────────────
    "htdemucs_ft.yaml": ["Vocals", "Drums", "Bass", "Other"],
    "htdemucs.yaml": ["Vocals", "Drums", "Bass", "Other"],
    "htdemucs_6s.yaml": ["Vocals", "Drums", "Bass", "Other", "Guitar", "Piano"],
    # ── MDX-Net ──────────────────────────────────────────────────────────────
    "UVR-MDX-NET-Inst_HQ_3.onnx": ["Vocals", "Instrumental"],
    # ── Roformer: vocal/instrumental splitters ────────────────────────────────
    "vocals_mel_band_roformer.ckpt": ["Vocals", "Other"],
    "melband_roformer_inst_v2.ckpt": ["Vocals", "Instrumental"],
    # ── Roformer: debleed ────────────────────────────────────────────────────
    "mel_band_roformer_bleed_suppressor_v1.ckpt": ["Instrumental", "Bleed"],
    # ── Roformer: denoise ────────────────────────────────────────────────────
    "denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt": ["Dry", "Other"],
}

DEFAULT_MODEL = "htdemucs_ft.yaml"
