"""Single source of truth for model -> stem metadata.

model_registry.json is built offline (see ~/Repos/audio-sep/build_model_registry.py,
not part of this repo) by actually resolving, for every model the front-end offers,
the audio-separator SDK's REAL internal stem name(s) — i.e. exactly what
CommonSeparator.get_stem_output_path() compares custom_output_names keys against
at runtime — and pairing them with our display/declared stem names once.

This replaces two things that used to happen at request time:
  - trusting whatever `stems` the front-end sent in configJson (now: config.stems
    is ignored; the registry's `stems` for the model is authoritative)
  - guessing the correspondence between our declared stem names and the SDK's
    real ones via runtime string-matching heuristics (strict + fuzzy fallback)

There is intentionally no fallback: a model missing from the registry, or
recorded with a non-"ok" status, fails the node immediately (see
handlers.get_model_entry usage) rather than guessing.
"""

import json
from pathlib import Path

_REGISTRY_PATH = Path(__file__).parent / "model_registry.json"


def _load_registry() -> dict:
    with open(_REGISTRY_PATH, encoding="utf-8") as f:
        return json.load(f)


MODEL_REGISTRY: dict = _load_registry()


def get_model_entry(model_filename: str) -> dict:
    """Look up a model's canonical metadata: {stems, stem_map, arch, category, label}.

    `stems` is the declared/display stem name list; `stem_map` pairs each declared
    name to the SDK's real internal stem name for that model (used to build
    output names that the SDK will actually apply, with no runtime guessing).

    Raises ValueError — no fallback — if the model is unknown or not yet resolved.
    """
    entry = MODEL_REGISTRY.get(model_filename)
    if entry is None:
        raise ValueError(
            f"Model '{model_filename}' is not in model_registry.json. "
            "No fallback — resolve it via build_model_registry.py and update the registry before using it."
        )
    if entry.get("status") != "ok":
        raise ValueError(
            f"Model '{model_filename}' is recorded in model_registry.json with status="
            f"'{entry.get('status')}' ({entry.get('error', 'unresolved')}). "
            "No fallback — resolve it via build_model_registry.py before using it."
        )
    return entry
