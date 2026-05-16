# Project Overview: audio-separation-worker

## Purpose
Python background worker for **Fluent Audio Split**. Consumes `ProcessNodeCommand` messages from RabbitMQ (published by the C# API via MassTransit), runs ML-based audio source separation, and publishes `NodeStarted/Completed/Failed` events back.

- No HTTP endpoints. No user auth. Pure consumer.
- Audio files exchanged via a shared Docker volume (`/data/audio`). Paths in messages are always **relative** to this mount.

## Tech Stack
| Concern | Choice |
|---|---|
| Runtime | Python 3.12 (slim Docker image) |
| Message Consumer | `kombu` (`ConsumerMixin`) — consumes MassTransit JSON envelopes |
| Broker | RabbitMQ (`amqp://`) — shared with C# API |
| Audio Separation | `audio-separator[cpu]` (nomadkaraoke/python-audio-separator) |
| Config | Environment variables (see `app/config.py`) |

## Directory Structure
```
src/audio-separation-worker/
├── Dockerfile
├── requirements.txt
├── run_consumer.py             ← Entry point for the kombu consumer
└── app/
    ├── models.py               ← MODEL_STEMS dict + DEFAULT_MODEL
    ├── handlers.py             ← ProcessNodeCommand dispatch + _handle_audio_separation
    ├── consumer.py             ← MassTransitConsumer (kombu ConsumerMixin)
    ├── publisher.py            ← publish_node_started/completed/failed
    ├── storage.py              ← FileStorageProvider / LocalFileStorageProvider
    ├── config.py               ← Env-based config constants
    ├── celery.py               ← Celery app instance (utility tasks)
    └── tasks.py                ← Celery tasks (health_check)
```

## Message Flow
1. C# API publishes `ProcessNodeCommand` to `process-node` fanout exchange
2. `MassTransitConsumer` receives, extracts envelope, calls `handle_process_node()`
3. `_handle_audio_separation()` resolves model, calls `Separator.separate()` with `output_names={stem: stem, ...}`
4. Builds `output_map: dict[str, str]` mapping stem name → relative file path
5. Publishes `NodeCompletedEvent` with `outputArtifactPaths` dict

## Model Registry (app/models.py)
```python
MODEL_STEMS = {
    "htdemucs_ft.yaml":               ["Vocals", "Drums", "Bass", "Other"],  # default
    "htdemucs.yaml":                  ["Vocals", "Drums", "Bass", "Other"],
    "htdemucs_6s.yaml":               ["Vocals", "Drums", "Bass", "Other", "Guitar", "Piano"],
    "UVR-MDX-NET-Inst_HQ_3.onnx":     ["Vocals", "Instrumental"],
    "vocals_mel_band_roformer.ckpt":   ["Vocals", "Other"],
}
DEFAULT_MODEL = "htdemucs_ft.yaml"
```
Keys are **exact filenames** passed to `separator.load_model()` — must include extension.
Must be kept in sync with `StemDefinitions.cs` (API) and `models.ts` (frontend).

## Configuration
| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_HOST` | `rabbitmq` | RabbitMQ hostname |
| `RABBITMQ_PORT` | `5672` | AMQP port |
| `RABBITMQ_USER` | `guest` | RabbitMQ username |
| `RABBITMQ_PASS` | `guest` | RabbitMQ password |
| `SHARED_DATA_PATH` | `/data` | Mount point for shared audio files |
