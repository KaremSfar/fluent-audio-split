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
    ├── model_registry.json      ← Single source of truth: model → stems + stem_map (SDK-real names)
    ├── model_registry.py        ← get_model_entry(modelName) — loads/validates registry, no fallback
    ├── validation.py            ← SeparationValidator (advancedParams keys only)
    ├── handlers.py              ← ProcessNodeCommand dispatch + _handle_audio_separation
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
3. `_handle_audio_separation()` calls `get_model_entry(modelName)` (raises, no fallback, if unknown/unresolved),
   then calls `Separator.separate()` with `output_names` keyed by the model's REAL SDK-internal stem names
   (from the registry's `stem_map`) so the SDK is guaranteed to apply them
4. Builds `output_map: dict[str, str]` mapping declared/display stem name → relative file path (exact reverse
   lookup via the same `stem_map` — no fuzzy filename matching)
5. Publishes `NodeCompletedEvent` with `outputArtifactPaths` dict

## Model Registry (app/model_registry.json + app/model_registry.py)
Single source of truth for model → stems, generated offline (not by this repo) by actually resolving each
model's real SDK-internal stem name(s) instead of hand-writing them — see `build_model_registry.py` in the
separate `audio-sep` exploration repo. Root cause this replaced: the SDK's `get_stem_output_path()` matches
custom output names against its own internal stem name using a lowercase-ONLY comparison (no whitespace
stripping); some models declare stems like "No Reverb" while the real internal name is literally "noreverb"
(no space), which used to silently drop that stem's output. `get_model_entry()` raises `ValueError` —
intentionally no fallback — if a model is missing or not `status: "ok"`.

## Validation (app/validation.py)
`SeparationValidator` now only sanity-checks `advancedParams` keys (`_validate_params()`, key sets:
`_COMMON_KEYS`, `_MDX_KEYS`, `_VR_KEYS`, `_DEMUCS_KEYS`, `_MDXC_KEYS`) and logs (doesn't raise) on unknown keys.
Model/stem existence validation moved to `model_registry.py` (no live SDK catalog network call anymore).

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
