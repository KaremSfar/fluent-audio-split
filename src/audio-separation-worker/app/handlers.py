import json
import logging
from pathlib import Path

from app.model_registry import get_model_entry
from app.publisher import publish_node_completed, publish_node_failed, publish_node_started
from app.separator import create_audio_separator
from app.storage import FileStorageProvider
from app.validation import SeparationValidator

logger = logging.getLogger("worker.handlers")


def _slug(stem: str) -> str:
    """Normalize a stem name to snake_case for use in filenames.

    Examples: "Vocals" → "vocals", "No Reverb" → "no_reverb",
              "Drum-Bass" → "drum_bass", "HH" → "hh"
    """
    return stem.lower().replace(" ", "_").replace("-", "_")


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
        for extra in ensemble_models if ensemble_enabled else []:
            get_model_entry(extra)  # existence check only; raises if unknown

        exec_prefix = node_execution_id[:5]
        output_names: dict[str, str] = {}
        # desired output filename -> declared/display stem name (for output_map)
        reverse_map: dict[str, str] = {}

        if ensemble_enabled:
            # The SDK's ensemble path groups per-model stems into canonical bucket
            # names (Vocals/Instrumental/etc, see STEM_NAME_MAP in the SDK) BEFORE
            # applying custom_output_names — it never compares against any single
            # model's real internal stem name. Declared/canonical names are
            # already correct here; the per-model stem_map indirection below is
            # only needed (and only correct) for the single-model path.
            for stem in model_entry["stems"]:
                normalized = f"{_slug(stem)}_{exec_prefix}"
                output_names[stem] = normalized
                reverse_map[normalized] = stem
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

        logger.info(
            "Separating %s with model %s → %s", abs_input, model_name, abs_output_dir
        )

        SeparationValidator().validate(advanced_params)

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
            is_transient=isinstance(e, OSError),
        )

