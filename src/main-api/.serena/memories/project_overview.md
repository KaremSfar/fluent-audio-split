# Project Overview: fluent-audio-split main-api

## Purpose
C# ASP.NET Core Web API backend for **Fluent Audio Split** — an audio stem-splitter app with a visual workflow/DAG editor.
- Users create visual audio-splitting pipelines on the React frontend, submit them, and this API **orchestrates their execution**.
- Actual ML inference (audio source separation) is done by a **Python background worker** using `audio-separator`, communicating via **RabbitMQ**.
- This API is a **pure orchestrator** — it never runs Python directly.

## Tech Stack
| Concern | Choice |
|---|---|
| Runtime | .NET 10, ASP.NET Core Web API |
| Auth | ASP.NET Identity API Endpoints (`AddIdentityApiEndpoints` + `MapIdentityApi`) — bearer tokens, 2FA, email verification built-in |
| Database | SQLite via EF Core (planned: PostgreSQL). Code-first migrations. |
| Message Queue | RabbitMQ via **MassTransit** (`MassTransit.RabbitMQ` v8.5.x (v9+ is commercial/licensed)). C# publishes to named queues; Python worker consumes via kombu. |
| File Storage | Local filesystem, abstracted behind `IFileStorage` (shared Docker volume `shared-audio` at `/data/audio`) |
| Observability | OpenTelemetry (`OpenTelemetry.Extensions.Hosting`) — ConsoleExporter for now |
| Logging | `Microsoft.Extensions.Logging` / `ILogger<T>` |
| API Docs | Swagger/Swashbuckle — available at `/swagger` in Development |

## Solution Structure
```
src/main-api/
├── FluentAudioSplit.slnx
├── FluentAudioSplit.Api/          ← ASP.NET Web API entry point
│   ├── Controllers/
│   │   └── DummyController.cs     ← POST /api/dummy/hello (sends HelloWorldCommand via MassTransit)
│   ├── Messages/
│   │   └── HelloWorldCommand.cs   ← MassTransit message contract
│   ├── Program.cs                 ← delegates to Startup
│   ├── Startup.cs                 ← ConfigureServices + Configure (incl. MassTransit registration)
│   └── appsettings.json
├── FluentAudioSplit.Auth/         ← REMOVED (replaced by built-in Identity API endpoints)
├── FluentAudioSplit.Domain/       ← Entities (ApplicationUser, Workflow) + interfaces
└── FluentAudioSplit.Infrastructure/ ← EF Core, ApplicationDbContext, MigrationsService, Migrations
```

## Auth Endpoints (via MapIdentityApi)
- `POST /api/auth/register` — `{ email, password }` → 200 or 400
- `POST /api/auth/login` — `{ email, password }` → 200 `{ tokenType, accessToken, expiresIn, refreshToken }` or 401
- `POST /api/auth/refresh` — token refresh
- Plus: 2FA, email confirmation, password reset endpoints (built-in)
- Uses ASP.NET Identity bearer tokens (not JWT)

## Configuration (appsettings.json)
- `ConnectionStrings:DefaultConnection` — SQLite path
- `JwtSettings:Secret` / `Issuer` / `Audience`
- `OpenTelemetry:Endpoint`
- In production override: `JwtSettings__Secret` env var

## Docker
- `docker compose up --build` from repo root
- Services: `api` (8080), `front` (3000), `rabbitmq` (5672 internal, 15672 management UI), `worker` (kombu consumer)
- SQLite in named volume `api-data` at `/data`; shared audio in `shared-audio` at `/data/audio`
- API env vars: `RabbitMq__Host`, `RabbitMq__Username`, `RabbitMq__Password`

## MassTransit Integration
- MassTransit is registered in `Startup.ConfigureServices` via `services.AddMassTransit(...)` with RabbitMQ transport
- Controllers inject `ISendEndpointProvider` to send messages to named queues (e.g. `queue:hello-world`)
- Message contracts live in `FluentAudioSplit.Api/Messages/`
- The Python worker (`src/audio-separation-worker`) consumes MassTransit messages via kombu, unwrapping the MassTransit JSON envelope

## Planned but Not Yet Implemented
- `Job`, `JobStep` entities and execution pipeline
- MassTransit consumers for worker completion events
- `/api/models`, `/api/workflows`, `/api/jobs` endpoints
- PostgreSQL migration
- Remove DummyController (test-only scaffold)
