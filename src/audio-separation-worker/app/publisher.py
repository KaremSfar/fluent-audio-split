import json
import uuid
from datetime import datetime, timezone

from kombu import Connection, Exchange, Producer

from app.config import BROKER_URL

_NAMESPACE = "FluentAudioSplit.Api.Messages"


def _build_envelope(class_name: str, message: dict) -> dict:
    """Build a MassTransit-compatible JSON envelope."""
    return {
        "messageId": str(uuid.uuid4()),
        "requestId": None,
        "correlationId": None,
        "conversationId": str(uuid.uuid4()),
        "initiatorId": None,
        "sourceAddress": "rabbitmq://rabbitmq/audio-separation-worker",
        "destinationAddress": None,
        "responseAddress": None,
        "faultAddress": None,
        "messageType": [f"urn:message:{_NAMESPACE}:{class_name}"],
        "message": message,
        "expirationTime": None,
        "sentTime": datetime.now(timezone.utc).isoformat(),
        "headers": {},
        "host": {},
    }


def publish_node_started(
    workflow_execution_id: str,
    node_execution_id: str,
) -> None:
    message = {
        "workflowExecutionId": workflow_execution_id,
        "nodeExecutionId": node_execution_id,
    }
    envelope = _build_envelope("NodeStartedEvent", message)
    _publish("node-started", envelope)


def publish_node_completed(
    workflow_execution_id: str,
    node_execution_id: str,
    output_artifact_paths: dict[str, str],
) -> None:
    message = {
        "workflowExecutionId": workflow_execution_id,
        "nodeExecutionId": node_execution_id,
        "outputArtifactPaths": output_artifact_paths,
    }
    envelope = _build_envelope("NodeCompletedEvent", message)
    _publish("node-completed", envelope)


def publish_node_failed(
    workflow_execution_id: str,
    node_execution_id: str,
    error_message: str,
    is_transient: bool = False,
) -> None:
    message = {
        "workflowExecutionId": workflow_execution_id,
        "nodeExecutionId": node_execution_id,
        "errorMessage": error_message,
        "isTransient": is_transient,
    }
    envelope = _build_envelope("NodeFailedEvent", message)
    _publish("node-failed", envelope)


def _publish(queue_name: str, envelope: dict) -> None:
    with Connection(BROKER_URL) as conn:
        exchange = Exchange(queue_name, type="fanout", durable=True)
        with conn.channel() as channel:
            producer = Producer(channel, exchange=exchange, serializer="json")
            producer.publish(envelope, declare=[exchange])
