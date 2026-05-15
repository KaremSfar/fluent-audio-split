# AI Instructions — Fluent Audio Split API

> **Audience:** Any AI agent or developer working on this codebase.
> Read this file in full before making changes.

---

## Project Context

This is the **C# ASP.NET Web API backend** for **Fluent Audio Split** — an audio stem-splitter app with a visual workflow/graph editor.

- Users create visual audio-splitting pipelines (DAGs) on the React frontend (`src/front`), submit them, and this API **orchestrates their execution**.
- The actual ML inference (audio source separation) is performed by a **Python background worker** using the [`audio-separator`](https://github.com/karaokenerds/python-audio-separator) package. This API communicates with it via a **RabbitMQ message queue**.
- The API **never** runs Python or `audio-separator` directly — it is purely an orchestrator.

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| **Runtime** | .NET 10 | ASP.NET Core Web API |
| **Auth** | ASP.NET Identity + JWT bearer tokens | `UserManager`/`SignInManager` + custom `ITokenService`. Frontend sends JWT in `Authorization` headers. |
| **Database** | SQLite via EF Core (will migrate to PostgreSQL) | Code-first migrations. SQLite file: `fluent_audio_split.db` |
| **Message Queue** | RabbitMQ via **MassTransit** (not yet wired) | Messages represent individual pipeline steps. |
| **File Storage** | Local filesystem (Docker volume) | Abstracted behind an interface (`IFileStorage`) so S3 can be swapped in later. |
| **Observability** | OpenTelemetry (`OpenTelemetry.Extensions.Hosting`) | TracerProvider + MeterProvider. Currently using `ConsoleExporter`. OTLP exporter is commented out pending collector setup. |
| **Logging** | `Microsoft.Extensions.Logging` | Structured logging via ILogger<T>. |
| **API Docs** | Swagger / Swashbuckle | Available at `/swagger` in Development. |

---

## Solution Structure

```
src/main-api/
├── FluentAudioSplit.slnx                    ← Solution file (.NET 10 slnx format)
├── FluentAudioSplit.Api/                    ← ASP.NET Web API project
│   ├── Controllers/
│   │   └── AuthController.cs               ← POST /api/auth/register, POST /api/auth/login
│   ├── Program.cs                           ← Entry point; delegates to Startup
│   ├── Startup.cs                           ← ConfigureServices + Configure
│   └── appsettings.json
│
├── FluentAudioSplit.Auth/                   ← Class library: identity/auth logic
│   ├── Models/
│   │   ├── AuthResponse.cs
│   │   ├── LoginRequest.cs
│   │   └── RegisterRequest.cs
│   └── Services/
│       ├── ITokenService.cs
│       └── TokenService.cs                 ← JWT generation
│
├── FluentAudioSplit.Domain/                 ← Class library: entities + interfaces
│   └── Entities/
│       ├── ApplicationUser.cs              ← Extends IdentityUser
│       └── Workflow.cs
│
└── FluentAudioSplit.Infrastructure/        ← Class library: EF Core, repos
    └── Persistence/
        ├── ApplicationDbContext.cs         ← IdentityDbContext<ApplicationUser>
        └── Migrations/                     ← EF Core migrations
```

---

## How to Run

```bash
cd src/main-api/FluentAudioSplit.Api
dotnet run
# API starts on https://localhost:5001 (or http://localhost:5000)
# Swagger UI: https://localhost:5001/swagger
```

---

## How to Add EF Migrations

```bash
cd src/main-api
export PATH="$PATH:$HOME/.dotnet/tools"   # if dotnet-ef not on PATH

dotnet ef migrations add <MigrationName> \
  --project FluentAudioSplit.Infrastructure/FluentAudioSplit.Infrastructure.csproj \
  --startup-project FluentAudioSplit.Api/FluentAudioSplit.Api.csproj \
  --context ApplicationDbContext \
  --output-dir Persistence/Migrations

# Apply migrations
dotnet ef database update \
  --project FluentAudioSplit.Infrastructure/FluentAudioSplit.Infrastructure.csproj \
  --startup-project FluentAudioSplit.Api/FluentAudioSplit.Api.csproj
```

---

## Auth Endpoints

All routes are prefixed with `/api/auth`.

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/auth/register` | `{ "email": "...", "password": "..." }` | `200 { message }` or `400 { errors }` |
| `POST` | `/api/auth/login` | `{ "email": "...", "password": "..." }` | `200 AuthResponse` or `401` |

`AuthResponse`:
```json
{
  "accessToken": "<JWT>",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "refreshToken": null
}
```

Tokens expire after **1 hour**. Include in requests as: `Authorization: Bearer <accessToken>`.

---

## Configuration (`appsettings.json`)

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Data Source=fluent_audio_split.db"
  },
  "JwtSettings": {
    "Secret": "dev-secret-key-at-least-32-chars-long-ok",
    "Issuer": "fluent-audio-split",
    "Audience": "fluent-audio-split-client"
  },
  "OpenTelemetry": {
    "Endpoint": "http://localhost:4317"
  }
}
```

**In production**, override `JwtSettings:Secret` via environment variable: `JwtSettings__Secret`.

---

## OpenTelemetry Setup

- Traces: `AddAspNetCoreInstrumentation` + `AddHttpClientInstrumentation` → **ConsoleExporter** (for now)
- Metrics: `AddAspNetCoreInstrumentation` → **ConsoleExporter** (for now)
- To switch to OTLP: uncomment the `AddOtlpExporter` line in `Startup.cs` and ensure the collector is running on `OpenTelemetry:Endpoint`.

---

## Core Domain Entities

### ApplicationUser
Extends `IdentityUser`. Adds `CreatedAt` timestamp.

### Workflow
A saved DAG definition belonging to a User.
- `GraphJson` — serialized JSON blob of the node graph
- A Workflow is a **template** — executing it creates a Job (not yet implemented)

---

## Planned Entities (Not Yet Implemented)

### Job
An execution instance of a Workflow. Statuses: `Pending` → `Running` → `Completed` | `Failed`

### JobStep
An individual processing step. Carries `inputFilePath`, `outputFilePaths[]`, `modelFilename`, `modelParams`, `status`.

---

## Key API Endpoints (Planned)

### Models
- `GET /api/models` — Available audio-separator models with metadata

### Workflows
- `POST /api/workflows` — Save a workflow graph
- `GET /api/workflows` — List current user's workflows
- `GET /api/workflows/{id}` — Get a specific workflow

### Execution
- `POST /api/workflows/{id}/execute` — Submit workflow → creates Job, enqueues steps
- `GET /api/jobs/{id}` — Job status + step statuses
- `GET /api/jobs/{id}/results` — Download links for completed stems

---

## Architecture Notes

### Job Execution Flow (Planned)
```
Frontend submits workflow
  → API validates DAG
  → Creates Job + JobSteps in DB (status: Pending)
  → Enqueues first step(s) to RabbitMQ
  → Python worker processes audio, publishes completion
  → API MassTransit consumer marks step Completed, writes output paths
  → Consumer enqueues next dependent steps
  → Repeat until all steps complete (Job → Completed) or fail (Job → Failed)
```

### MassTransit Message Contract (Planned)
```json
{
  "jobId": "guid",
  "stepId": "guid",
  "inputFilePath": "uploads/abc123/input.wav",
  "modelFilename": "htdemucs_ft.yaml",
  "modelParams": {}
}
```

File paths are **relative to the shared volume mount**, never absolute.

---

## Important Constraints

1. **No Python in this project.** The API orchestrates via the queue only.
2. **Relative file paths only** in all messages and DB records.
3. **JWT expiry:** 1-hour access tokens.
4. **Async/await everywhere.** No blocking calls (`Task.Result`, `.Wait()`, `GetAwaiter().GetResult()`).
5. **Do NOT roll custom password hashing.** Use ASP.NET Identity (`UserManager`, `SignInManager`).
6. **All controllers** use `[Route("api/[controller]")]` prefix.
7. **Startup class pattern** — `Program.cs` delegates to `Startup.ConfigureServices` and `Startup.Configure`. Do NOT collapse back to minimal API style.

---

## Coding Conventions

- Standard C# naming: PascalCase public, `_camelCase` private fields.
- Nullable reference types enabled (`<Nullable>enable</Nullable>`).
- Keep controllers thin — business logic belongs in services/domain layer.
- Register dependencies via `IServiceCollection` extension methods per layer (e.g. `AddInfrastructure()`, `AddAuth()`).
- Use the Options pattern (`IOptions<T>`) for typed config sections.
- Use `FluentValidation` or Data Annotations for request validation.

---

## Docker Setup (Planned)

| Service | Image | Port(s) |
|---|---|---|
| **api** | Standard ASP.NET Docker image | `5000` |
| **postgres** | `postgres:16` | `5432` |
| **rabbitmq** | `rabbitmq:3-management` | `5672` (AMQP), `15672` (management UI) |
| **python-worker** | Custom (added later) | — |

