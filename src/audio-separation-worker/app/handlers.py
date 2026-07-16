import json
import logging
import re
from pathlib import Path

from app.publisher import publish_node_completed, publish_node_failed, publish_node_started
from app.separator import create_audio_separator
from app.storage import FileStorageProvider
from app.validation import SeparationValidator

logger = logging.getLogger("worker.handlers")

# Matches the audio-separator SDK's default output filename pattern:
# "{audio_base}_({stem_name})_{model_name}.{ext}" — used as a fallback when the
# SDK didn't apply our custom output name (see _fuzzy_normalize below).
_DEFAULT_NAME_STEM_RE = re.compile(r"\(([^)]+)\)")


def _normalize_stem_name(stem: str) -> str:
    """Normalize a stem name to snake_case for use in filenames.

    Examples: "Vocals" → "vocals", "No Reverb" → "no_reverb",
              "Drum-Bass" → "drum_bass", "HH" → "hh"
    """
    return stem.lower().replace(" ", "_").replace("-", "_")


def _fuzzy_normalize(stem: str) -> str:
    """Normalize a stem name for loose comparison: lowercase, strip spaces/hyphens/underscores.

    The audio-separator SDK matches our custom output names against its own internal
    primary/secondary stem names (from the model's training config) using a lowercase-only
    comparison — it does NOT strip whitespace. Some models declare stems like "No Reverb"
    while their internal instrument name is literally "noreverb" (no space), which makes the
    SDK's exact match fail and fall back to its own default filename. This looser comparison
    is used only as a fallback to recover those otherwise-dropped stems.
    """
    return stem.lower().replace(" ", "").replace("-", "").replace("_", "")


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

    stems: list[str] = config.get("stems") or ["Vocals", "Instrumental"]

    # Build deterministic output filenames: {stem_normalized}_{execId[:5]}
    exec_prefix = node_execution_id[:5]
    output_names: dict[str, str] = {}
    # Strict reverse map: normalized output filename → canonical stem name
    reverse_map: dict[str, str] = {}
    # Fuzzy fallback map: loosely-normalized canonical stem name → canonical stem name.
    # Used when the SDK didn't apply our custom output name (see _fuzzy_normalize).
    fuzzy_reverse_map: dict[str, str] = {}

    for stem in stems:
        normalized = f"{_normalize_stem_name(stem)}_{exec_prefix}"
        output_names[stem] = normalized
        reverse_map[normalized] = stem
        fuzzy_reverse_map[_fuzzy_normalize(stem)] = stem

    try:
        model_name = config.get("modelName")
        if not model_name:
            raise ValueError(
                "Missing required 'modelName' in node config. "
                "Specify a valid audio-separator model filename (e.g. 'htdemucs_ft.yaml', "
                "'UVR-MDX-NET-Inst_HQ_3.onnx')."
            )
        abs_input = storage.get_absolute_path(input_path)
        abs_output_dir = storage.get_absolute_path(output_dir)
        abs_output_dir.mkdir(parents=True, exist_ok=True)

        logger.info(
            "Separating %s with model %s → %s", abs_input, model_name, abs_output_dir
        )

        ensemble_enabled: bool = config.get("ensembleEnabled") is True
        ensemble_models: list[str] = config.get("ensembleModels") or []
        ensemble_algorithm: str = config.get("ensembleMethod", "avg_wave")
        advanced_params: dict | None = config.get("advancedParams") or None

        validator = SeparationValidator()
        validator.validate(
            model_name,
            stems=stems,
            extra_models=ensemble_models if ensemble_enabled else None,
            advanced_params=advanced_params,
        )

        publish_node_started(workflow_execution_id, node_execution_id)

        separator = create_audio_separator()
        output_files = separator.separate(
            abs_input, abs_output_dir, model_name, output_names,
            extra_models=ensemble_models if ensemble_enabled else None,
            ensemble_algorithm=ensemble_algorithm,
            advanced_params=advanced_params,
        )

        abs_base = storage.get_absolute_path("").resolve()
        output_map: dict[str, str] = {}

        for f in output_files:
            p = Path(f).resolve()
            try:
                rel = str(p.relative_to(abs_base))
            except ValueError:
                rel = str(Path(output_dir) / p.name)

            # Strict match: look up exact normalized filename in reverse map. This is the
            # expected path when the SDK applied our custom output name.
            file_stem = p.stem
            matched = reverse_map.get(file_stem)

            if not matched:
                # Fallback: the SDK didn't apply our custom name (e.g. because its internal
                # stem name differs from ours only in spacing/casing) and fell back to its own
                # default pattern "{audio_base}_({stem_name})_{model_name}.{ext}". Extract the
                # parenthesized stem hint and compare it loosely against our canonical stems,
                # so the output isn't silently dropped.
                name_match = _DEFAULT_NAME_STEM_RE.search(p.name)
                if name_match:
                    candidate = fuzzy_reverse_map.get(_fuzzy_normalize(name_match.group(1)))
                    if candidate and candidate not in output_map:
                        matched = candidate
                        logger.info(
                            "Output file '%s' matched stem '%s' via fuzzy fallback "
                            "(no exact match; SDK likely used its own default naming).",
                            p.name,
                            candidate,
                        )

            if matched:
                output_map[matched] = rel
            else:
                logger.warning(
                    "Output file '%s' did not strictly match any expected stem. "
                    "Expected one of: %s",
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
            is_transient=isinstance(e, OSError),
        )
