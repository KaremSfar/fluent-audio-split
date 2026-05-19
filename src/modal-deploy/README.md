# Audio Separator — Modal Deployment

Deploys [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) as a GPU-accelerated API on [Modal](https://modal.com), secured with an API key.

- **~$0.01–0.015 per separation job** (Nvidia T4 GPU)
- **$30/month free credits** ≈ 2,000+ jobs/month for free
- All endpoints require `X-API-Key` header (except `/health`)

## One-time setup

### 1. Sign up and authenticate with Modal

```bash
pip install -r requirements.txt
modal setup
```

### 2. Create your secret API key in Modal

Pick any string as your key (e.g. generate one with `openssl rand -hex 32`):

```bash
modal secret create audio-separator-api-key API_KEY=<your-secret-key-here>
```

### 3. Deploy

```bash
modal deploy deploy_modal.py
```

You'll see output like:

```
✓ Created web function api => https://YOUR_USERNAME--audio-separator-api.modal.run
```

## Connecting the worker

Copy the URL and key into `.env` at the repo root:

```bash
AUDIO_SEPARATOR_API_URL=https://YOUR_USERNAME--audio-separator-api.modal.run
AUDIO_SEPARATOR_API_KEY=your-secret-key-here
```

The worker will automatically use the remote API instead of local GPU separation.

## Testing the deployment

```bash
# Set env vars
export AUDIO_SEPARATOR_API_URL="https://YOUR_USERNAME--audio-separator-api.modal.run"
export AUDIO_SEPARATOR_API_KEY="your-secret-key-here"

# Health check + model list
python test_deployment.py

# Full separation test
python test_deployment.py path/to/song.mp3
```

## API Endpoints

| Method | Path                                 | Auth | Description                |
| ------ | ------------------------------------ | ---- | -------------------------- |
| `POST` | `/separate`                          | ✅   | Upload audio + start job   |
| `GET`  | `/status/{task_id}`                  | ✅   | Poll job progress          |
| `GET`  | `/download/{task_id}/{file_hash}`    | ✅   | Download output file       |
| `GET`  | `/models`                            | ✅   | List models (plain text)   |
| `GET`  | `/models-json`                       | ✅   | List models (JSON)         |
| `GET`  | `/health`                            | ❌   | Health check               |
| `GET`  | `/`                                  | ❌   | API info                   |
