# Suggested Commands

All commands run from `/home/karemsfar/Repos/fluent-audio-split/src/audio-separation-worker` unless noted.

## Run Consumer (locally)
```bash
export RABBITMQ_HOST=localhost
python run_consumer.py
```

## Run Celery Worker (utility tasks)
```bash
celery -A app.celery:celery_app worker --loglevel=info
```

## Install Dependencies
```bash
pip install -r requirements.txt
# Note: torch/torchaudio must be installed from PyTorch CPU index:
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

## Docker (from repo root)
```bash
docker compose up --build audio-separation-worker
```

## Lint / Type Check
No linter or type checker is configured in this project yet. Use `mypy` or `ruff` if added.

## Tests
No test framework is configured yet.
