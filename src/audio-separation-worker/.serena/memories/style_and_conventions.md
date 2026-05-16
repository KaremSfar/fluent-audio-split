# Code Style and Conventions

## Language & Types
- **Python 3.12+** with type hints on all function signatures
- Use `snake_case` everywhere (variables, functions, modules)

## Patterns
- Use `logging` module, never `print()`
- All Celery task names prefixed with `audio.` (e.g. `audio.health_check`)
- Tasks and handlers must be **idempotent** (safe to retry)
- File paths in messages are always **relative** — use `storage.get_absolute_path()` to resolve

## Message Handling
- MassTransit JSON envelope format: `{"messageType": [...], "message": {...}}`
- Consumer extracts `messageType` URN to dispatch to correct handler
- Handler dispatch lives in `app/handlers.py` via the `MESSAGE_HANDLERS` dict in `consumer.py`
- Publisher wraps outgoing events in MassTransit envelope format before sending

## Storage
- Always access files via `FileStorageProvider.get_absolute_path(relative_path)`
- Never build absolute paths directly from message data
- `LocalFileStorageProvider` prepends `SHARED_DATA_PATH` config value

## Dependencies
- `kombu` — AMQP messaging (ConsumerMixin pattern)
- `audio-separator` — ML audio source separation (wraps demucs models)
- `torch` / `torchaudio` — installed separately from PyTorch CPU index in Dockerfile
- `onnxruntime` — inference runtime for some models

## Error Handling
- On handler failure: publish `NodeFailedEvent` with error message and `isTransient` flag
- Consumer acks messages after processing (success or handled failure)
