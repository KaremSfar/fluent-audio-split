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
    ├── validation.py           ← SeparationValidator (validates models, stems, params)
    ├── handlers.py             ← ProcessNodeCommand dispatch + _handle_audio_separation
    ├── consumer.py             ← MassTransitConsumer (kombu ConsumerMixin)
    ├── publisher.py            ← publish_node_started/completed/failed
    ├── storage.py              ← FileStorageProvider / LocalFileStorageProvider
    ├── separator.py            ← AudioSeparator ABC + LocalAudioSeparator + RemoteAudioSeparator + create_audio_separator()
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

## Validation (app/validation.py)
`SeparationValidator` validates incoming `ProcessNodeCommand` messages before separation:
- `_validate_models()` — checks model filenames are recognized by the audio-separator catalog
- `_validate_stems()` — ensures requested stems exist for the model
- `_validate_params()` — filters/validates advanced params; key sets: `_COMMON_KEYS`, `_MDX_KEYS`, `_VR_KEYS`, `_DEMUCS_KEYS`, `_MDXC_KEYS`

**Note**: `models.py` was removed. The worker no longer maintains its own `MODEL_STEMS` dict — model validation is done against the audio-separator library catalog at runtime. Model stem definitions are maintained in `StemDefinitions.cs` (API) and `models.ts` (frontend).

## Separator Abstraction (app/separator.py)
- `AudioSeparator` — ABC with `separate(input_path, output_dir, model_name, output_names, extra_models?, ensemble_algorithm?, advanced_params?) → list[str]`
- `LocalAudioSeparator` — runs ML inference locally (default when `AUDIO_SEPARATOR_API_URL` is unset). Maps `advanced_params` to `Separator()` constructor kwargs + arch-specific param dicts (`mdx_params`, `vr_params`, `demucs_params`, `mdxc_params`).
- `RemoteAudioSeparator` — delegates to a Modal/remote API via `AudioSeparatorAPIClient`. Passes `advanced_params` as flat kwargs to `separate_audio_and_wait()`.
- Ensemble is handled natively by the SDK — `Separator(ensemble_algorithm=...)` + `load_model([m1, m2, ...])`; no custom blending needed
- `create_audio_separator()` — factory; returns Remote if `AUDIO_SEPARATOR_API_URL` is set, else Local

## Ensemble Support
Ensemble is configured per-node via `configJson`:
```json
{ "modelName": "htdemucs_ft.yaml", "ensembleEnabled": true, "ensembleModels": ["htdemucs.yaml"], "ensembleMethod": "avg_wave" }
```
`ensembleMethod` uses SDK algorithm names directly: `avg_wave` (default), `median_wave`, `min_wave`, `max_wave`, `avg_fft`, `median_fft`, `min_fft`, `max_fft`, `uvr_max_spec`, `uvr_min_spec`, `ensemble_wav`.
Compatible models = same stem set as primary. The SDK's `ensemble_algorithm` param handles blending natively.

## Advanced Parameters
`configJson.advancedParams` is an optional dict of separation params (e.g. `output_format`, `normalization_threshold`, `mdx_segment_size`, `vr_aggression`, etc.). The handler reads it and passes it through to `separator.separate()`. `LocalAudioSeparator` maps arch-prefixed keys (e.g. `mdx_segment_size`) to nested param dicts (`mdx_params={"segment_size": ...}`). `RemoteAudioSeparator` passes them as flat kwargs. Common keys: `output_format`, `normalization_threshold`, `amplification_threshold`, `invert_using_spec`, `sample_rate`, `use_soundfile`, `use_autocast`.

## Configuration
| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_HOST` | `rabbitmq` | RabbitMQ hostname |
| `RABBITMQ_PORT` | `5672` | AMQP port |
| `RABBITMQ_USER` | `guest` | RabbitMQ username |
| `RABBITMQ_PASS` | `guest` | RabbitMQ password |
| `SHARED_DATA_PATH` | `/data` | Mount point for shared audio files |
| `AUDIO_SEPARATOR_API_URL` | `""` | If set, use remote API instead of local GPU |
| `AUDIO_SEPARATOR_API_KEY` | `""` | API key for remote audio separator |
