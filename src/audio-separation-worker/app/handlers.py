import logging

logger = logging.getLogger("worker.handlers")


def handle_hello_world(payload: dict) -> None:
    """Handle HelloWorldCommand from the C# API."""
    message = payload.get("message", "")
    logger.info("Hello World received: %s", message)
