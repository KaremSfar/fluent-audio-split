from celery.utils.log import get_task_logger
from app.celery import celery_app

logger = get_task_logger(__name__)


@celery_app.task(name="audio.health_check")
def health_check():
    """Simple health-check task to verify the worker is alive."""
    return {"status": "ok"}


@celery_app.task(name="audio.hello_world")
def hello_world(message: str):
    """Logs the received message and returns it."""
    logger.info(message)
    return {"status": "ok", "message": message}
