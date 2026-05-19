import json
import logging
from pathlib import Path

from app.models import DEFAULT_MODEL
from app.publisher import publish_node_completed, publish_node_failed, publish_node_started
from app.separator import create_audio_separator
from app.storage import FileStorageProvider

logger = logging.getLogger("worker.handlers")


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

    model_name = config.get("modelName", DEFAULT_MODEL)
    stems: list[str] = config.get("stems") or ["Vocals", "Instrumental"]
    output_names = {stem: stem for stem in stems}

    try:
        abs_input = storage.get_absolute_path(input_path)
        abs_output_dir = storage.get_absolute_path(output_dir)
        abs_output_dir.mkdir(parents=True, exist_ok=True)

        logger.info(
            "Separating %s with model %s → %s", abs_input, model_name, abs_output_dir
        )

        publish_node_started(workflow_execution_id, node_execution_id)

        ensemble_enabled: bool = config.get("ensembleEnabled") is True
        ensemble_models: list[str] = config.get("ensembleModels") or []
        ensemble_algorithm: str = config.get("ensembleMethod", "avg_wave")
        advanced_params: dict | None = config.get("advancedParams") or None

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

            # Match the output file to a stem name.
            # audio-separator wraps the stem name in parentheses: e.g. "(No Drums)".
            # Check for the parenthesized form first so that "Drums" does not
            # accidentally match a "(No Drums)" filename before "No Drums" does.
            file_stem = p.stem
            file_stem_lower = file_stem.lower()
            matched_stem = None
            for stem in sorted(stems, key=len, reverse=True):
                if f"({stem.lower()})" in file_stem_lower:
                    matched_stem = stem
                    break
            # Fallback: plain substring match (longest stem first to stay safe)
            if matched_stem is None:
                for stem in sorted(stems, key=len, reverse=True):
                    if stem.lower() in file_stem_lower:
                        matched_stem = stem
                        break

            if matched_stem:
                output_map[matched_stem] = rel
            else:
                output_map[file_stem] = rel

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
