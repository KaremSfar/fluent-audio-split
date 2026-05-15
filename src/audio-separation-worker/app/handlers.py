import json
import logging
from pathlib import Path

from app.publisher import publish_node_completed, publish_node_failed, publish_node_started
from app.storage import FileStorageProvider

logger = logging.getLogger("worker.handlers")

DEFAULT_MODEL = "htdemucs_ft.yaml"


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
    # Ensure Demucs models have the .yaml extension
    if "." not in model_name:
        model_name = f"{model_name}.yaml"

    try:
        abs_input = storage.get_absolute_path(input_path)
        abs_output_dir = storage.get_absolute_path(output_dir)
        abs_output_dir.mkdir(parents=True, exist_ok=True)

        logger.info(
            "Separating %s with model %s → %s", abs_input, model_name, abs_output_dir
        )

        publish_node_started(workflow_execution_id, node_execution_id)

        from audio_separator.separator import Separator

        separator = Separator(output_dir=str(abs_output_dir))
        separator.load_model(model_filename=model_name)
        output_files: list[str] = separator.separate(str(abs_input))

        abs_base = storage.get_absolute_path("").resolve()
        relative_outputs: list[str] = []
        for f in output_files:
            p = Path(f).resolve()
            try:
                rel = str(p.relative_to(abs_base))
            except ValueError:
                rel = str(Path(output_dir) / p.name)
            relative_outputs.append(rel)

        logger.info("Separation complete. Outputs: %s", relative_outputs)
        publish_node_completed(workflow_execution_id, node_execution_id, relative_outputs)

    except Exception as e:
        logger.exception("Audio separation failed")
        publish_node_failed(
            workflow_execution_id,
            node_execution_id,
            str(e),
            is_transient=isinstance(e, OSError),
        )
