# AI Instructions — Audio Separation Worker

> **Audience:** Any AI agent or developer working on this codebase.
> Read this file in full before making changes.

---

## Project Context

This is the **Python background worker** for **Fluent Audio Split**. It consumes `ProcessNodeCommand` messages from RabbitMQ (published by the C# API via MassTransit), runs ML-based audio source separation, and publishes `NodeStarted/Completed/Failed` events back.

- No HTTP endpoints. No user auth. Pure consumer.
- Audio files exchanged via a **shared Docker volume** (`/data/audio`). Paths in messages are always **relative** to the mount root.

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Python 3.12 | Slim Docker image |
| Message Consumer | `kombu` (`ConsumerMixin`) | Consumes MassTransit JSON envelopes |
| Broker | RabbitMQ (`amqp://`) | Shared with C# API |
| Audio Separation | `audio-separator[cpu]` | nomadkaraoke/python-audio-separator |
| Config | Environment variables | See `app/config.py` |

---

## Project Structure

```
src/audio-separation-worker/
├── Dockerfile
├── requirements.txt
├── run_consumer.py             ← Entry point for the kombu consumer
└── app/
    ├── models.py               ← MODEL_STEMS dict + DEFAULT_MODEL (source of truth for worker)
    ├── handlers.py             ← handle_process_node() dispatch + _handle_audio_separation()
    ├── consumer.py             ← MassTransitConsumer (kombu ConsumerMixin)
    ├── publisher.py            ← publish_node_started / publish_node_completed / publish_node_failed
    ├── storage.py              ← FileStorageProvider ABC + LocalFileStorageProvider
    ├── config.py               ← Env-based configuration constants
    ├── celery.py               ← Celery app instance (utility tasks)
    └── tasks.py                ← Celery tasks (health_check)
```

---

## Message Flow

```
C# API
  → publishes ProcessNodeCommand to exchange: process-node (fanout)

kombu MassTransitConsumer
  → receives MassTransit JSON envelope
  → extracts payload, calls handle_process_node(payload, storage)

handle_process_node (handlers.py)
  → dispatches by nodeType == "AudioSeparation"
  → calls _handle_audio_separation(payload, storage)

_handle_audio_separation
  → resolves model filename from configJson.modelName
  → looks up stems from MODEL_STEMS
  → calls publish_node_started(...)
  → runs Separator.separate(input_path, output_names={stem: stem, ...})
  → builds output_map: dict[str, str]  (stemName → relative path)
  → calls publish_node_completed(..., output_map)

C# API NodeCompletedConsumer
  → receives NodeCompletedEvent with outputArtifactPaths dict
  → chains downstream nodes
```

---

## Model Registry (app/models.py)

**This is the worker's source of truth for model→stem mappings.**

```python
MODEL_STEMS: dict[str, list[str]] = {
    "htdemucs_ft.yaml":              ["Vocals", "Drums", "Bass", "Other"],  # default
    "htdemucs.yaml":                 ["Vocals", "Drums", "Bass", "Other"],
    "htdemucs_6s.yaml":              ["Vocals", "Drums", "Bass", "Other", "Guitar", "Piano"],
    "UVR-MDX-NET-Inst_HQ_3.onnx":    ["Vocals", "Instrumental"],
    "vocals_mel_band_roformer.ckpt":  ["Vocals", "Other"],
}
DEFAULT_MODEL = "htdemucs_ft.yaml"
```

**Critical rules:**
- Keys are **exact filenames** passed to `separator.load_model()` — must include extension
- Bare names like `htdemucs_ft` or `UVR-MDX-NET-Inst_HQ_3` will raise `ValueError: Model file not found`
- Must be kept in sync with `StemDefinitions.cs` (C# API) and `models.ts` (React frontend)

---

## audio-separator API Usage

```python
separator = Separator(output_dir=str(abs_output_dir))
separator.load_model(model_filename="htdemucs_ft.yaml")
output_files: list[str] = separator.separate(str(abs_input), output_names)
```

- `output_names`: `dict[str, str]` — keys are the library's internal stem names, values are desired output base names
  - e.g. `{"Vocals": "Vocals", "Drums": "Drums", "Bass": "Bass", "Other": "Other"}`
- `separate()` returns a list of absolute output file paths
- After separation, `handlers.py` maps each output file back to a stem name by checking if the stem name appears in the filename

---

## MassTransit Message Contracts

### ProcessNodeCommand (received from C# API)
```json
{
  "workflowExecutionId": "guid",
  "nodeExecutionId": "guid",
  "nodeType": "AudioSeparation",
  "inputArtifactPath": "uploads/userId/fileId/audio.wav",
  "outputArtifactDir": "executions/execId/nodes/nodeExecId/",
  "configJson": "{\"modelName\": \"htdemucs_ft.yaml\"}"
}
```

### NodeCompletedEvent (published back to C# API)
```json
{
  "workflowExecutionId": "guid",
  "nodeExecutionId": "guid",
  "outputArtifactPaths": {
    "Vocals": "executions/execId/nodes/nodeExecId/Vocals.wav",
    "Drums":  "executions/execId/nodes/nodeExecId/Drums.wav"
  }
}
```

### NodeFailedEvent (published back to C# API)
```json
{
  "workflowExecutionId": "guid",
  "nodeExecutionId": "guid",
  "errorMessage": "...",
  "isTransient": false
}
```

File paths in all messages are **relative to the shared storage base path** — never absolute.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_HOST` | `rabbitmq` | RabbitMQ hostname |
| `RABBITMQ_PORT` | `5672` | AMQP port |
| `RABBITMQ_USER` | `guest` | RabbitMQ username |
| `RABBITMQ_PASS` | `guest` | RabbitMQ password |
| `RABBITMQ_VHOST` | `/` | Virtual host |
| `SHARED_DATA_PATH` | `/data` | Mount point for shared audio files |

---

## How to Run Locally

```bash
cd src/audio-separation-worker
pip install -r requirements.txt
RABBITMQ_HOST=localhost python run_consumer.py
```

---

## Important Constraints

1. **No HTTP.** This worker never exposes a server — pure RabbitMQ consumer.
2. **Relative paths only** — never store or send absolute paths in messages.
3. **Model filenames must include extension** — pass exact keys from `MODEL_STEMS`.
4. **Stem names are case-sensitive** — `"Vocals"` not `"vocals"`.
5. When adding a new model, update `MODEL_STEMS` here **and** `StemDefinitions.cs` in the API **and** `MODEL_DEFINITIONS` in the frontend.
