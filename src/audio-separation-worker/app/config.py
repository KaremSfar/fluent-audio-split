import os

RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "rabbitmq")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_USER = os.getenv("RABBITMQ_USER", "guest")
RABBITMQ_PASS = os.getenv("RABBITMQ_PASS", "guest")
RABBITMQ_VHOST = os.getenv("RABBITMQ_VHOST", "/")

BROKER_URL = (
    f"amqp://{RABBITMQ_USER}:{RABBITMQ_PASS}"
    f"@{RABBITMQ_HOST}:{RABBITMQ_PORT}/{RABBITMQ_VHOST}"
)

# No result backend for now — the worker publishes completion
# messages back to RabbitMQ for the C# API to consume.
RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "rpc://")

SHARED_DATA_PATH = os.getenv("SHARED_DATA_PATH", "/data")
