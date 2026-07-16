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

MODEL_FILE_DIR = os.getenv("AUDIO_SEPARATOR_MODEL_DIR", "/models")

# Number of concurrent consumer threads pulling from the "process-node" queue.
# Each thread owns its own broker connection/channel, so sibling nodes of a
# forked workflow graph (fanned out by NodeCompletedConsumer) can be picked up
# and processed in parallel instead of queueing behind a single-threaded loop.
WORKER_CONCURRENCY = int(os.getenv("WORKER_CONCURRENCY", "3"))

# Remote audio separator API (if set, worker delegates separation to remote server)
AUDIO_SEPARATOR_API_URL = os.getenv("AUDIO_SEPARATOR_API_URL", "")
AUDIO_SEPARATOR_API_KEY = os.getenv("AUDIO_SEPARATOR_API_KEY", "")
