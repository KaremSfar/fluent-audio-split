# Project Overview: audio-separation-worker

## Purpose
Python background worker for **Fluent Audio Split**. Consumes audio-processing commands from **RabbitMQ** (published by the C# API via MassTransit), runs ML-based audio source separation, and publishes completion/failure events back to RabbitMQ.

- Pure consumer — no HTTP endpoints, no user auth.
- Audio files exchanged via a shared Docker volume (`/data`). Paths in messages are always relative to this mount.

## Tech Stack
| Concern | Choice |
|---|---|
| Runtime | Python 3.12 (slim Docker image) |
| Message Consumer | `kombu` (`ConsumerMixin`) — consumes MassTransit JSON envelopes |
| Utility Tasks | Celery 5.5 (health_check, hello_world) |
| Broker | RabbitMQ (`amqp://`) — shared with C# API |
| Audio Separation | `audio-separator` (nomadkaraoke/python-audio-separator) |
| ML Backend | PyTorch CPU (torch + torchaudio) |
| Config | Environment variables (see `app/config.py`) |

## Directory Structure
```
src/audio-separation-worker/
├── Dockerfile
├── requirements.txt            ← kombu, onnxruntime, audio-separator
├── run_consumer.py             ← Entry point for the kombu consumer
├── AI_INSTRUCTIONS.md          ← Detailed project docs
└── app/
    ├── __init__.py
    ├── celery.py               ← Celery app instance
    ├── config.py               ← Env-based configuration constants
    ├── consumer.py             ← MassTransitConsumer (kombu ConsumerMixin)
    ├── handlers.py             ← Message handler dispatch + AudioSeparation logic
    ├── publisher.py            ← Publishes NodeStarted/Completed/Failed events
    ├── storage.py              ← FileStorageProvider ABC + LocalFileStorageProvider
    └── tasks.py                ← Celery tasks (health_check, hello_world)
```

## Message Flow
1. C# API publishes `ProcessNodeCommand` to `process-node` fanout exchange
2. `MassTransitConsumer` receives message, extracts MassTransit envelope
3. `handle_process_node()` dispatches by `nodeType` (currently: `AudioSeparation`)
4. `_handle_audio_separation()` runs `audio-separator` model on input file
5. On success: publishes `NodeCompletedEvent` with output artifact paths
6. On failure: publishes `NodeFailedEvent` with error details

## Configuration (Environment Variables)
| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_HOST` | `rabbitmq` | RabbitMQ hostname |
| `RABBITMQ_PORT` | `5672` | AMQP port |
| `RABBITMQ_USER` | `guest` | RabbitMQ username |
| `RABBITMQ_PASS` | `guest` | RabbitMQ password |
| `RABBITMQ_VHOST` | `/` | Virtual host |
| `SHARED_DATA_PATH` | `/data` | Mount point for shared audio files |

## Audio Separator Models
- `htdemucs_ft` → 4-stem (vocals/drums/bass/other) — default
- `htdemucs_6s` → 6-stem (adds guitar/piano)
- `htdemucs` → base model
