# AI Instructions — Audio Separation Worker

> **Audience:** Any AI agent or developer working on this codebase.
> Read this file in full before making changes.

---

## Project Context

This is the **Python background worker** for **Fluent Audio Split**. It consumes audio-processing commands from **RabbitMQ** via a kombu-based consumer, runs ML-based audio source separation, and publishes completion/failure events back to RabbitMQ.

- The **C# ASP.NET API** (`src/main-api`) is the sole producer of commands. It publishes messages via **MassTransit** to RabbitMQ.
- This worker **never** exposes HTTP endpoints or handles user authentication — it is a pure consumer.
- Audio files are exchanged via a **shared Docker volume** (`/data`). File paths in messages are always **relative** to this mount.

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| **Runtime** | Python 3.12 | Slim Docker image |
| **Message Consumer** | `kombu` (via `ConsumerMixin`) | Directly consumes MassTransit envelopes |
| **Task Execution** | Celery 5.5 | Kept for `health_check` / utility tasks |
| **Broker** | RabbitMQ (`amqp://`) | Shared with C# API |
| **Audio Separation** | `audio-separator[cpu]` | [nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) |
| **Config** | Environment variables | See `app/config.py` |

---

## Project Structure

```
src/audio-separation-worker/
├── Dockerfile
├── requirements.txt
├── run_consumer.py             ← Entry point for the kombu consumer
├── AI_INSTRUCTIONS.md          ← You are here
└── app/
    ├── __init__.py
    ├── celery.py               ← Celery app instance (utility tasks)
    ├── config.py               ← Env-based configuration
    ├── consumer.py             ← MassTransitConsumer (kombu ConsumerMixin)
    ├── handlers.py             ← Message handler dispatch + AudioSeparation logic
    ├── publisher.py            ← Publishes NodeCompletedEvent / NodeFailedEvent
    ├── storage.py              ← FileStorageProvider abstraction (local impl)
    └── tasks.py                ← Celery task definitions (health_check, etc.)
```

---

## How to Run

### Via Docker Compose (recommended)

```bash
# From repo root
docker compose up --build
```

### Locally (consumer)

```bash
cd src/audio-separation-worker
pip install -r requirements.txt
export RABBITMQ_HOST=localhost
python run_consumer.py
```

### Locally (Celery worker, utility tasks only)

```bash
celery -A app.celery:celery_app worker --loglevel=info
```

---

## Configuration (Environment Variables)

| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_HOST` | `rabbitmq` | RabbitMQ hostname (Docker service name) |
| `RABBITMQ_PORT` | `5672` | RabbitMQ AMQP port |
| `RABBITMQ_USER` | `guest` | RabbitMQ username |
| `RABBITMQ_PASS` | `guest` | RabbitMQ password |
| `RABBITMQ_VHOST` | `/` | RabbitMQ virtual host |
| `SHARED_DATA_PATH` | `/data` | Mount point for shared audio files |

---

## Message Contracts (MassTransit JSON Envelope)

### Incoming: `ProcessNodeCommand`

Queue/exchange: `process-node` (fanout, durable)

```json
{
  "messageType": ["urn:message:FluentAudioSplit.Api.Messages:ProcessNodeCommand"],
  "message": {
    "workflowExecutionId": "guid",
    "nodeExecutionId": "guid",
    "nodeType": "AudioSeparation",
    "inputArtifactPath": "uploads/userId/fileId/original.wav",
    "outputArtifactDir": "executions/execId/nodes/nodeExecId/",
    "configJson": "{\"modelName\":\"htdemucs_ft\",\"stems\":[\"vocals\",\"drums\",\"bass\",\"other\"]}"
  }
}
```

All file paths are **relative to `SHARED_DATA_PATH`**, never absolute.

### Outgoing: `NodeCompletedEvent`

Exchange: `node-completed` (fanout, durable)

```json
{
  "messageType": ["urn:message:FluentAudioSplit.Api.Messages:NodeCompletedEvent"],
  "message": {
    "workflowExecutionId": "guid",
    "nodeExecutionId": "guid",
    "outputArtifactPaths": ["executions/execId/nodes/nodeExecId/vocals.wav", "..."]
  }
}
```

### Outgoing: `NodeFailedEvent`

Exchange: `node-failed` (fanout, durable)

```json
{
  "messageType": ["urn:message:FluentAudioSplit.Api.Messages:NodeFailedEvent"],
  "message": {
    "workflowExecutionId": "guid",
    "nodeExecutionId": "guid",
    "errorMessage": "...",
    "isTransient": false
  }
}
```

---

## Key Modules

### `app/storage.py` — File Storage Abstraction

`FileStorageProvider` (ABC) with `LocalFileStorageProvider`. Always access files via `storage.get_absolute_path(relative_path)` — never build absolute paths directly from message data.

### `app/publisher.py` — Event Publisher

`publish_node_completed(...)` and `publish_node_failed(...)` wrap the payload in a MassTransit envelope and send to the appropriate fanout exchange.

### `app/handlers.py` — Handler Dispatch

`handle_process_node(payload, storage)` dispatches by `nodeType`. Currently supports `"AudioSeparation"` via `_handle_audio_separation(...)`.

**Audio Separator API** (`audio-separator` library):
```python
from audio_separator.separator import Separator

separator = Separator(output_dir="/abs/output/dir")
separator.load_model(model_filename="htdemucs_ft.yaml")
output_files: list[str] = separator.separate("/abs/input/file.wav")
# output_files — list of absolute paths to separated stems
```

Available Demucs model names (pass in `configJson.modelName`):
- `htdemucs_ft` → `htdemucs_ft.yaml` (4-stem: vocals/drums/bass/other — default)
- `htdemucs_6s` → `htdemucs_6s.yaml` (6-stem: adds guitar/piano)
- `htdemucs` → `htdemucs.yaml`

For GPU hosts, install `audio-separator[gpu]` instead of `audio-separator[cpu]`.

### `app/consumer.py` — MassTransit Consumer

`MassTransitConsumer` (kombu `ConsumerMixin`) listens on `process-node` queue, unwraps the MassTransit envelope, and calls `handle_process_node(payload, self.storage)`.

---

## Coding Conventions

- **Python 3.12+** type hints on all signatures.
- **snake_case** everywhere.
- Use `logging`, not `print()`.
- All Celery task names prefixed with `audio.`.
- Tasks and handlers must be **idempotent** (safe to retry).
- File paths in messages are always **relative** — use `storage.get_absolute_path()`.

---

## Handler / Task Status

| Handler / Task | Description | Status |
|---|---|---|
| `ProcessNodeCommand` → `AudioSeparation` | Run `audio-separator` on input file | ✅ Implemented |
| `audio.health_check` | Simple ping to verify worker is alive | ✅ Implemented |

---
