<audio controls src="Opeth - Ghost of Perdition (Audio) split_(Drums)_htdemucs_ft.wav" title="Title"></audio>Created 0 todos

```
# Fluent Audio Split

An audio stem separation app built around [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator). Users create visual pipeline workflows — chaining ML models to progressively split audio into stems — and download the results.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  React SPA  │────▶│  C# ASP.NET API  │────▶│  RabbitMQ    │────▶│  Python Worker  │
│  Port 5173  │◀────│  Port 5001       │◀────│  (queue)     │◀────│ audio-separator │
└─────────────┘     └──────────────────┘     └──────────────┘     └─────────────────┘
                             │                                              │
                      SQLite / PostgreSQL                       Shared file storage
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, Vite, React Flow, Shadcn/ui, TanStack Query |
| API | ASP.NET Core (.NET 10), ASP.NET Identity, JWT, EF Core |
| Database | SQLite (dev) → PostgreSQL (prod) |
| Worker | Python, `audio-separator` (CPU inference) |
| Queue | RabbitMQ + MassTransit |
| Observability | OpenTelemetry (console now, OTLP-ready) |

## Project Structure

```
src/
├── front/                              # React SPA
│   └── src/
│       ├── auth/                       # AuthContext, JWT handling
│       ├── pages/                      # Login, Register, Dashboard
│       ├── services/                   # Axios API client
│       └── telemetry/                  # OTel stub
└── main-api/
    ├── FluentAudioSplit.Api/           # Controllers, Startup, middleware
    ├── FluentAudioSplit.Auth/          # TokenService, JWT generation
    ├── FluentAudioSplit.Domain/        # Entities (ApplicationUser, Workflow)
    └── FluentAudioSplit.Infrastructure/ # EF Core DbContext, migrations
```

## Getting Started

### API
```bash
cd src/main-api
dotnet ef database update \
  --project FluentAudioSplit.Infrastructure \
  --startup-project FluentAudioSplit.Api \
  --context ApplicationDbContext
dotnet run --project FluentAudioSplit.Api --launch-profile http
# API  → http://localhost:5001
# Swagger → http://localhost:5001/swagger
```

### Frontend
```bash
cd src/front
cp .env.example .env.development
npm install
npm run dev
# → http://localhost:5173
```

## Auth Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register new user |
| `POST` | `/api/auth/login` | Login, returns JWT |

## Status

- [x] React app — auth pages (login/register), Shadcn/ui, TanStack Query, Storybook
- [x] ASP.NET Identity + JWT authentication
- [x] EF Core + SQLite with initial migration
- [x] OpenTelemetry instrumentation (OTLP-ready)
- [x] CORS configured for local dev
- [ ] Workflow graph editor (React Flow)
- [ ] Python worker + audio-separator integration
- [ ] RabbitMQ job queue + pipeline execution
- [ ] Job progress streaming (SSE)
```