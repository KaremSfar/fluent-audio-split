import json
import logging
import tempfile
from pathlib import Path

from app.audio_trim import trim_audio
from app.model_registry import get_model_entry
from app.publisher import publish_node_completed, publish_node_failed, publish_node_started
from app.separator import TransientSeparationError, create_audio_separator
from app.storage import FileStorageProvider
from app.validation import SeparationValidator

logger = logging.getLogger("worker.handlers")


def _slug(stem: str) -> str:
    """Normalize a stem name to snake_case for use in filenames.

    Examples: "Vocals" → "vocals", "No Reverb" → "no_reverb",
              "Drum-Bass" → "drum_bass", "HH" → "hh"
    """
    return stem.lower().replace(" ", "_").replace("-", "_")


# Exact copy of audio_separator.separator.separator.STEM_NAME_MAP — must stay in
# sync with the installed SDK version so _ensemble_bucket_name below reproduces
# precisely the same canonical bucket name the SDK's _separate_ensemble computes
# for each model's real stem name.
_SDK_STEM_NAME_MAP = {
    "vocals": "Vocals",
    "instrumental": "Instrumental",
    "inst": "Instrumental",
    "karaoke": "Instrumental",
    "other": "Other",
    "no_vocals": "Instrumental",
    "drums": "Drums",
    "bass": "Bass",
    "guitar": "Guitar",
    "piano": "Piano",
    "synthesizer": "Synthesizer",
    "strings": "Strings",
    "woodwinds": "Woodwinds",
    "brass": "Brass",
    "wind inst": "Wind Inst",
    "lead vocals": "Lead Vocals",
    "backing vocals": "Backing Vocals",
    "primary stem": "Primary Stem",
    "secondary stem": "Secondary Stem",
}


def _ensemble_bucket_name(model_real_stems: list[str], raw_stem_name: str) -> str:
    """Replicates audio_separator's Separator._separate_ensemble stem-bucket-naming
    logic for a single raw (real/internal) stem name, given the full list of real
    stem names that model produces. Used to predict, ahead of time, what bucket
    name the SDK will group this stem's output under during ensembling."""
    lower_name = raw_stem_name.lower()
    num_model_stems = len(model_real_stems)
    has_vocal_stem = any("vocal" in s.lower() or s.lower() in ("vocals",) for s in model_real_stems)

    if "vocal" in lower_name and "lead" not in lower_name and "backing" not in lower_name:
        return "Vocals"
    elif lower_name == "other" and num_model_stems == 2 and has_vocal_stem:
        return "Instrumental"
    elif lower_name in _SDK_STEM_NAME_MAP:
        return _SDK_STEM_NAME_MAP[lower_name]
    else:
        return raw_stem_name.title()


def handle_process_node(payload: dict, storage: FileStorageProvider) -> None:
    """Dispatch ProcessNodeCommand payload to the appropriate node handler."""
    node_type = payload.get("nodeType", "")

    if node_type == "AudioSeparation":
        _handle_audio_separation(payload, storage)
    else:
        logger.error("Unknown nodeType: %s", node_type)
        publish_node_started(payload["workflowExecutionId"], payload["nodeExecutionId"])
        publish_node_failed(
            payload["workflowExecutionId"],
            payload["nodeExecutionId"],
            f"Unknown nodeType: {node_type}",
            is_transient=False,
        )


def _handle_audio_separation(payload: dict, storage: FileStorageProvider) -> None:
    workflow_execution_id = payload["workflowExecutionId"]
    node_execution_id = payload["nodeExecutionId"]
    input_path = payload["inputArtifactPath"]
    output_dir = payload["outputArtifactDir"]
    config = json.loads(payload.get("configJson", "{}"))

    try:
        trim_start: float | None = payload.get("trimStartSeconds")
        trim_end: float | None = payload.get("trimEndSeconds")
        if trim_start is not None and trim_end is not None and trim_end <= trim_start:
            raise ValueError("trimEndSeconds must be greater than trimStartSeconds")

        model_name = config.get("modelName")
        if not model_name:
            raise ValueError(
                "Missing required 'modelName' in node config. "
                "Specify a valid audio-separator model filename (e.g. 'htdemucs_ft.yaml', "
                "'UVR-MDX-NET-Inst_HQ_3.onnx')."
            )

        ensemble_enabled: bool = config.get("ensembleEnabled") is True
        ensemble_models: list[str] = config.get("ensembleModels") or []
        ensemble_algorithm: str = config.get("ensembleMethod", "avg_wave")
        advanced_params: dict | None = config.get("advancedParams") or None

        # model_registry.json is the single source of truth for model -> stems.
        # config.get("stems") from the front-end is intentionally ignored — no
        # fallback: an unknown/unresolved model fails the node immediately.
        model_entry = get_model_entry(model_name)
        extra_entries = {extra: get_model_entry(extra) for extra in (ensemble_models if ensemble_enabled else [])}

        exec_prefix = node_execution_id[:5]
        output_names: dict[str, str] = {}
        # desired output filename -> declared/display stem name (for output_map)
        reverse_map: dict[str, str] = {}

        if ensemble_enabled:
            # The SDK's ensemble path re-derives a canonical "bucket" name for each
            # model's own real/internal stem name independently (STEM_NAME_MAP plus
            # vocal/"other" heuristics in audio_separator's Separator._separate_ensemble),
            # falling back to raw_stem_name.title() for anything it doesn't recognize —
            # which is every stem type outside its small built-in vocabulary (e.g. our
            # dereverb/denoise/karaoke categories). Ensemble member models can declare
            # their real internal stem name with different casing/spacing for the exact
            # same conceptual stem (e.g. "noreverb" vs "No Reverb"), so title()-ing each
            # independently can produce DIFFERENT bucket names for what should be one
            # stem. Any bucket whose name doesn't exactly match one of our
            # custom_output_names keys gets a generic auto-generated filename and is
            # silently dropped by the reverse_map lookup below instead of being
            # downloadable — replicate the SDK's exact canonicalization here for every
            # model in the ensemble and register every resulting bucket-name variant, so
            # no stem a model actually produces is ever silently lost.
            all_entries = {model_name: model_entry, **extra_entries}
            for stem in model_entry["stems"]:
                normalized = f"{_slug(stem)}_{exec_prefix}"
                reverse_map[normalized] = stem
                output_names[stem] = normalized  # exact declared name (covers the common case)
                for entry in all_entries.values():
                    real = entry["stem_map"].get(stem)
                    if real is None:
                        continue
                    bucket = _ensemble_bucket_name(list(entry["stem_map"].values()), real)
                    output_names[bucket] = normalized
        else:
            # stem_map pairs our declared/display stem name with the SDK's real
            # internal stem name for this exact model (pre-resolved once, offline,
            # in model_registry.json) — guarantees the SDK applies our custom name
            # with no runtime guessing.
            for declared, real in model_entry["stem_map"].items():
                normalized = f"{_slug(declared)}_{exec_prefix}"
                output_names[real] = normalized
                reverse_map[normalized] = declared

        abs_input = storage.get_absolute_path(input_path)
        abs_output_dir = storage.get_absolute_path(output_dir)
        abs_output_dir.mkdir(parents=True, exist_ok=True)

        trim_stack = None
        if trim_start is not None or trim_end is not None:
            trim_stack = tempfile.TemporaryDirectory()
            trimmed_path = Path(trim_stack.name) / "trimmed_input.wav"
            trim_audio(abs_input, trimmed_path, trim_start, trim_end)
            abs_input = trimmed_path

        logger.info(
            "Separating %s with model %s → %s", abs_input, model_name, abs_output_dir
        )

        SeparationValidator().validate(advanced_params)

        publish_node_started(workflow_execution_id, node_execution_id)

        try:
            separator = create_audio_separator()
            output_files = separator.separate(
                abs_input, abs_output_dir, model_name, output_names,
                extra_models=ensemble_models if ensemble_enabled else None,
                ensemble_algorithm=ensemble_algorithm,
                advanced_params=advanced_params,
            )
        finally:
            if trim_stack is not None:
                trim_stack.cleanup()

        abs_base = storage.get_absolute_path("").resolve()
        output_map: dict[str, str] = {}

        for f in output_files:
            p = Path(f).resolve()
            try:
                rel = str(p.relative_to(abs_base))
            except ValueError:
                rel = str(Path(output_dir) / p.name)

            matched = reverse_map.get(p.stem)
            if matched:
                output_map[matched] = rel
            else:
                logger.warning(
                    "Output file '%s' did not match any expected stem name. Expected one of: %s",
                    p.name,
                    list(reverse_map.keys()),
                )

        logger.info("Separation complete. Outputs: %s", output_map)
        publish_node_completed(workflow_execution_id, node_execution_id, output_map)

    except Exception as e:
        logger.exception("Audio separation failed")
        publish_node_failed(
            workflow_execution_id,
            node_execution_id,
            str(e),
            is_transient=isinstance(e, (OSError, TransientSeparationError)),
        )

