# AI Instructions — Audio Separation Worker

> **Audience:** Any AI agent or developer working on this codebase.
> Read this file in full before making changes.

---

## Project Context

This is the **Python Celery background worker** for **Fluent Audio Split**. It consumes audio-processing jobs from a **RabbitMQ** message queue, runs ML-based audio source separation, and writes results back to shared storage.

- The **C# ASP.NET API** (`src/main-api`) is the sole producer of tasks. It publishes messages via **MassTransit** to RabbitMQ.
- This worker **never** exposes HTTP endpoints or handles user authentication — it is a pure consumer.
- Audio files are exchanged via a **shared Docker volume** (`/data`). File paths in messages are always **relative** to this mount.

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| **Runtime** | Python 3.12 | Slim Docker image |
| **Task Queue** | Celery 5.5 | With `librabbitmq` C extension for performance |
| **Broker** | RabbitMQ (via `amqp://`) | Shared with the C# API (MassTransit) |
| **Audio Separation** | `audio-separator` *(planned)* | [karaokenerds/python-audio-separator](https://github.com/karaokenerds/python-audio-separator) |
| **Config** | Environment variables | See `app/config.py` |

---

## Project Structure

```
src/audio-separation-worker/
├── Dockerfile
├── requirements.txt
├── AI_INSTRUCTIONS.md          ← You are here
└── app/
    ├── __init__.py
    ├── celery.py               ← Celery app instance + config
    ├── config.py               ← Env-based configuration
    └── tasks.py                ← Task definitions (start here)
```

---

## How to Run

### Via Docker Compose (recommended)

```bash
# From repo root
docker compose up --build
```

### Locally (for development)

```bash
cd src/audio-separation-worker
pip install -r requirements.txt
export RABBITMQ_HOST=localhost
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

## Message Contract

Messages from the C# API will follow this structure (MassTransit JSON envelope):

```json
{
  "jobId": "guid",
  "stepId": "guid",
  "inputFilePath": "uploads/abc123/input.wav",
  "modelFilename": "htdemucs_ft.yaml",
  "modelParams": {}
}
```

All file paths are **relative to `SHARED_DATA_PATH`**, never absolute.

---

## Coding Conventions

- **Python 3.12+** features are welcome (type hints, `match` statements, etc.)
- Use **snake_case** for everything (modules, functions, variables).
- Keep tasks thin — heavy logic belongs in dedicated service modules under `app/`.
- Use **type hints** on all function signatures.
- Use **`logging`** (via Celery's built-in logger), not `print()`.
- All task names must be prefixed with `audio.` (e.g. `audio.separate_stems`).

---

## Important Constraints

1. **No HTTP endpoints.** This service is a pure Celery worker.
2. **No authentication.** The worker trusts all messages from the queue.
3. **Relative file paths only** — never construct absolute paths from message data; always join with `SHARED_DATA_PATH`.
4. **One task = one audio processing step.** Do not batch multiple steps in a single task.
5. **Idempotent tasks.** Tasks may be retried; design for safe re-execution.
6. **`task_acks_late=True`** — messages are acknowledged only after successful processing, ensuring at-least-once delivery.

---

## Planned Tasks

| Task Name | Description | Status |
|---|---|---|
| `audio.health_check` | Simple ping to verify worker is alive | ✅ Implemented |
| `audio.separate_stems` | Run `audio-separator` on an input file | 🔲 Planned |

---
