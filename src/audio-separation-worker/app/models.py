"""Hardcoded model → stem definitions for audio separation models.

Keys are the exact filenames passed to separator.load_model() (including extension).
"""

MODEL_STEMS: dict[str, list[str]] = {
    "htdemucs_ft.yaml": ["Vocals", "Drums", "Bass", "Other"],
    "htdemucs.yaml": ["Vocals", "Drums", "Bass", "Other"],
    "htdemucs_6s.yaml": ["Vocals", "Drums", "Bass", "Other", "Guitar", "Piano"],
    "UVR-MDX-NET-Inst_HQ_3.onnx": ["Vocals", "Instrumental"],
    "vocals_mel_band_roformer.ckpt": ["Vocals", "Other"],
}

DEFAULT_MODEL = "htdemucs_ft.yaml"
