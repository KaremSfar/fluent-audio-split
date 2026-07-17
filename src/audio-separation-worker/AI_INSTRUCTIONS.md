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
    ├── model_registry.json     ← Single source of truth: model → stems + stem_map (SDK-real names)
    ├── model_registry.py       ← get_model_entry(modelName) — loads/validates model_registry.json, no fallback
    ├── handlers.py             ← handle_process_node() dispatch + _handle_audio_separation()
    ├── validation.py           ← SeparationValidator — advancedParams key sanity-checks only
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
  → get_model_entry(modelName) in model_registry.py — raises ValueError (no fallback) if the
    model is missing or not yet resolved in model_registry.json; configJson.stems is ignored
  → calls publish_node_started(...)
  → runs Separator.separate(input_path, output_names={realStemName: desiredFilename, ...})
    — output_names keys come from entry.stem_map's REAL (SDK-internal) stem names so the SDK
    is guaranteed to apply them, no runtime string-matching/guessing
  → builds output_map: dict[str, str]  (declared/display stemName → relative path)
  → calls publish_node_completed(..., output_map)

C# API NodeCompletedConsumer
  → receives NodeCompletedEvent with outputArtifactPaths dict
  → chains downstream nodes
```

---

## Model Registry (app/model_registry.json + app/model_registry.py)

**This is the worker's single source of truth for model→stem mappings.** Unlike a hand-written dict, it's
generated offline by actually resolving, for every model the front-end offers, the audio-separator SDK's REAL
internal stem name(s) — i.e. exactly what `CommonSeparator.get_stem_output_path()` compares custom output
names against at runtime — and pairing them with our display/declared stem names once (see
`build_model_registry.py` in the separate `audio-sep` exploration repo, not part of this repo).

```jsonc
{
  "deverb_bs_roformer_8_384dim_10depth.ckpt": {
    "label": "BS-Roformer | De-Reverb",
    "category": "dereverb",
    "arch": "mdxc",
    "stems": ["No Reverb", "Reverb"],           // display/declared names
    "stem_map": {"No Reverb": "noreverb", "Reverb": "reverb"},  // declared -> SDK-real
    "status": "ok"
  }
}
```

**Critical rules:**
- Keys are **exact filenames** passed to `separator.load_model()` — must include extension
- `get_model_entry(modelName)` (app/model_registry.py) raises `ValueError` with **no fallback** if the model is
  missing or its `status` isn't `"ok"` — an unresolved/unknown model fails the node immediately
- Must be kept in sync with `StemDefinitions.cs` (C# API) and `models.ts` (React frontend) — regenerate/copy in
  `model_registry.json` whenever `models.ts`'s `MODEL_DEFINITIONS` changes

---

## audio-separator API Usage

```python
separator = Separator(output_dir=str(abs_output_dir))
separator.load_model(model_filename="htdemucs_ft.yaml")
output_files: list[str] = separator.separate(str(abs_input), output_names)
```

- `output_names`: `dict[str, str]` — keys must be the library's REAL internal stem names for that exact model
  (not necessarily the same as our display names — e.g. `"noreverb"` not `"No Reverb"`), values are desired
  output base names. `model_registry.json`'s `stem_map` provides this real-name key for each declared stem, so
  `handlers.py` never has to guess it.
  - e.g. `{"Vocals": "vocals_a1b2c", "Instrumental": "instrumental_a1b2c"}`
- `separate()` returns a list of absolute output file paths
- Because `output_names` already uses the SDK's real stem name as the key, the SDK is guaranteed to apply our
  custom filename — `handlers.py` maps each output file back to its declared/display stem name via an exact
  reverse-lookup (built from the same `stem_map`), no fuzzy filename matching needed

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
3. **Model filenames must include extension** — pass exact keys from `model_registry.json`.
4. **Stem names are case-sensitive** — `"Vocals"` not `"vocals"`.
5. **No fallback for unknown/unresolved models.** `get_model_entry()` raises immediately if a model isn't in
   `model_registry.json` with `status: "ok"` — this is intentional; don't add a default-stems fallback.
6. When adding a new model, add it to `MODEL_DEFINITIONS` in the frontend's `models.ts` **and**
   `StemDefinitions.cs` in the API, then regenerate/copy in this worker's `app/model_registry.json` (via
   `build_model_registry.py` in the separate `audio-sep` exploration repo) before it can be used.
