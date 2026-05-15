"""
MassTransit message consumer.

Listens to RabbitMQ queues that MassTransit publishes/sends to,
unwraps the MassTransit JSON envelope, and dispatches to handler functions.
"""

import json
import logging
import signal

from kombu import Connection, Exchange, Queue
from kombu.mixins import ConsumerMixin

from app.config import BROKER_URL, SHARED_DATA_PATH
from app.handlers import handle_process_node
from app.storage import LocalFileStorageProvider

logger = logging.getLogger("worker.consumer")

process_node_exchange = Exchange("process-node", type="fanout", durable=True)
process_node_queue = Queue("process-node", exchange=process_node_exchange, durable=True)

MESSAGE_HANDLERS: dict[str, callable] = {
    "ProcessNodeCommand": handle_process_node,
}


def _extract_message_type(message_types: list[str]) -> str | None:
    """Extract the short class name from MassTransit's URN message type."""
    for urn in message_types:
        # Format: "urn:message:Namespace:ClassName"
        parts = urn.split(":")
        if len(parts) >= 4:
            return parts[-1]
    return None


class MassTransitConsumer(ConsumerMixin):
    def __init__(self, connection: Connection) -> None:
        self.connection = connection
        self.storage = LocalFileStorageProvider(SHARED_DATA_PATH)

    def get_consumers(self, consumer_class, channel):
        return [
            consumer_class(
                queues=[process_node_queue],
                callbacks=[self.on_message],
            ),
        ]

    def on_message(self, body, message) -> None:
        try:
            envelope = json.loads(body) if isinstance(body, (str, bytes)) else body

            message_types = envelope.get("messageType", [])
            type_name = _extract_message_type(message_types)
            payload = envelope.get("message", {})

            handler = MESSAGE_HANDLERS.get(type_name)
            if handler:
                logger.info("Dispatching %s", type_name)
                handler(payload, self.storage)
            else:
                logger.warning("No handler for message type: %s", type_name)

            message.ack()
        except Exception:
            logger.exception("Failed to process message")
            message.reject()


def run() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("Starting MassTransit consumer, broker=%s", BROKER_URL)

    with Connection(BROKER_URL) as conn:
        consumer = MassTransitConsumer(conn)

        def shutdown(signum, frame):
            logger.info("Shutting down consumer...")
            consumer.should_stop = True

        signal.signal(signal.SIGTERM, shutdown)
        signal.signal(signal.SIGINT, shutdown)

        consumer.run()


if __name__ == "__main__":
    run()
