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
| Auth | ASP.NET Identity + JWT bearer tokens (`UserManager`/`SignInManager` + `ITokenService`) |
| Database | SQLite via EF Core (planned: PostgreSQL). Code-first migrations. |
| Message Queue | RabbitMQ via MassTransit (not yet wired) |
| File Storage | Local filesystem, abstracted behind `IFileStorage` |
| Observability | OpenTelemetry (`OpenTelemetry.Extensions.Hosting`) — ConsoleExporter for now |
| Logging | `Microsoft.Extensions.Logging` / `ILogger<T>` |
| API Docs | Swagger/Swashbuckle — available at `/swagger` in Development |

## Solution Structure
```
src/main-api/
├── FluentAudioSplit.slnx
├── FluentAudioSplit.Api/          ← ASP.NET Web API entry point
│   ├── Controllers/AuthController.cs
│   ├── Program.cs                 ← delegates to Startup
│   ├── Startup.cs                 ← ConfigureServices + Configure
│   └── appsettings.json
├── FluentAudioSplit.Auth/         ← JWT/identity logic (ITokenService, TokenService, request/response models)
├── FluentAudioSplit.Domain/       ← Entities (ApplicationUser, Workflow) + interfaces
└── FluentAudioSplit.Infrastructure/ ← EF Core, ApplicationDbContext, MigrationsService, Migrations
```

## Auth Endpoints
- `POST /api/auth/register` — `{ email, password }` → 200 or 400
- `POST /api/auth/login` — `{ email, password }` → 200 `AuthResponse` or 401
- JWT tokens expire after **1 hour**, sent as `Authorization: Bearer <token>`

## Configuration (appsettings.json)
- `ConnectionStrings:DefaultConnection` — SQLite path
- `JwtSettings:Secret` / `Issuer` / `Audience`
- `OpenTelemetry:Endpoint`
- In production override: `JwtSettings__Secret` env var

## Docker
- `docker compose up --build` from repo root
- API on port `8080`, frontend on `3000`
- SQLite in named volume `api-data` at `/data` inside container

## Planned but Not Yet Implemented
- `Job`, `JobStep` entities and execution pipeline
- MassTransit consumers for worker completion events
- `/api/models`, `/api/workflows`, `/api/jobs` endpoints
- PostgreSQL migration
