"""
MassTransit message consumer.

Listens to RabbitMQ queues that MassTransit publishes/sends to,
unwraps the MassTransit JSON envelope, and dispatches to handler functions.
"""

import json
import logging
import signal
import threading

from kombu import Connection, Exchange, Queue
from kombu.mixins import ConsumerMixin

from app.config import BROKER_URL, SHARED_DATA_PATH, WORKER_CONCURRENCY
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
    def __init__(self, connection: Connection, worker_id: int = 0) -> None:
        self.connection = connection
        self.worker_id = worker_id
        self.storage = LocalFileStorageProvider(SHARED_DATA_PATH)

    def get_consumers(self, consumer_class, channel):
        return [
            consumer_class(
                queues=[process_node_queue],
                callbacks=[self.on_message],
                # Only let this connection hold one unacked message at a time. Combined with
                # running WORKER_CONCURRENCY of these consumers on independent connections/threads
                # (see `run()` below), this gives true competing-consumers parallelism: sibling
                # nodes of a forked workflow (fanned out by NodeCompletedConsumer) are picked up by
                # different consumer threads and processed concurrently instead of queueing behind
                # a single-threaded consumer loop.
                prefetch_count=1,
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
                logger.info("[worker-%d] Dispatching %s", self.worker_id, type_name)
                handler(payload, self.storage)
            else:
                logger.warning("No handler for message type: %s", type_name)

            message.ack()
        except Exception:
            logger.exception("Failed to process message")
            message.reject()


def _run_consumer_thread(worker_id: int, stop_event: threading.Event) -> None:
    with Connection(BROKER_URL) as conn:
        consumer = MassTransitConsumer(conn, worker_id=worker_id)
        # ConsumerMixin calls on_iteration() every event-loop tick, giving us a safe place to
        # observe the shared shutdown signal and stop this thread's loop gracefully.
        consumer.on_iteration = lambda: setattr(consumer, "should_stop", stop_event.is_set())
        logger.info("[worker-%d] Consumer thread started", worker_id)
        consumer.run()
        logger.info("[worker-%d] Consumer thread stopped", worker_id)


def run() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info(
        "Starting %d MassTransit consumer thread(s), broker=%s", WORKER_CONCURRENCY, BROKER_URL
    )

    stop_event = threading.Event()
    threads = [
        threading.Thread(
            target=_run_consumer_thread,
            args=(worker_id, stop_event),
            name=f"consumer-{worker_id}",
            daemon=True,
        )
        for worker_id in range(WORKER_CONCURRENCY)
    ]

    def shutdown(signum, frame):
        logger.info("Shutting down consumers...")
        stop_event.set()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    for t in threads:
        t.start()
    for t in threads:
        t.join()


if __name__ == "__main__":
    run()
