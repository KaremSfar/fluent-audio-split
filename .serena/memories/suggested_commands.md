# Suggested Commands

## Full Stack (Docker)
```bash
docker compose up --build          # Build & start all services
docker compose down                # Stop all services
docker compose logs -f api         # Follow API logs
docker compose logs -f worker      # Follow worker logs
```

## API (local dev)
```bash
cd src/main-api
dotnet ef database update \
  --project FluentAudioSplit.Infrastructure \
  --startup-project FluentAudioSplit.Api \
  --context ApplicationDbContext
dotnet run --project FluentAudioSplit.Api --launch-profile http
# → http://localhost:8080/swagger
```

## Frontend (local dev)
```bash
cd src/front
cp .env.example .env.development
npm install
npm run dev                        # → http://localhost:5173
npm run build                      # Production build
npm run storybook                  # Component playground
```

## Python Worker (local dev)
```bash
cd src/audio-separation-worker
pip install -r requirements.txt
RABBITMQ_HOST=localhost python run_consumer.py
```

## Git
```bash
git --no-pager log --oneline -10
git --no-pager diff main..HEAD --stat
```
