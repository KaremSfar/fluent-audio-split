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
| **Runtime** | .NET 8+ (latest LTS) | ASP.NET Core Web API |
| **Auth** | ASP.NET Identity + JWT bearer tokens | Use built-in `MapIdentityApi` endpoints — do **NOT** roll custom auth. Frontend sends JWT in `Authorization` headers. |
| **Database** | PostgreSQL via EF Core (Npgsql provider) | Code-first migrations. |
| **Message Queue** | RabbitMQ via **MassTransit** | Messages represent individual pipeline steps. |
| **File Storage** | Local filesystem (Docker volume) | Abstracted behind an interface (`IFileStorage`) so S3 can be swapped in later. |
| **Observability** | OpenTelemetry (`OpenTelemetry.Extensions.Hosting`) | TracerProvider + MeterProvider with OTLP exporter. Instrument ASP.NET Core, HttpClient, EF Core, and MassTransit. Default to console/no-op exporter until OTel collector is added. |
| **Logging** | `Microsoft.Extensions.Logging` with OTel log bridge | Logs flow into the same OTel pipeline. |

---

## Core Domain Entities

### User
Standard ASP.NET Identity user. No custom fields required initially.

### Workflow
A saved DAG definition belonging to a User.
- Stored as a JSON blob of nodes, edges, and per-node model configurations.
- A Workflow is a **template** — executing it creates a Job.

### Job
An execution instance of a Workflow. Belongs to a User.
- **Statuses:** `Pending` → `Running` → `Completed` | `Failed`

### JobStep
An individual processing step within a Job. Maps to **one** model execution.
- `inputFilePath` — relative path to the input audio file on the shared volume
- `outputFilePaths[]` — relative paths to the output stems (populated after completion)
- `modelFilename` — the model file to use (e.g. `htdemucs_ft.yaml`)
- `modelParams` — model-specific parameters (JSON)
- `status` — `Pending` | `Running` | `Completed` | `Failed`
- `order` / dependency references — determines execution order within the DAG

---

## Key API Endpoints (Planned)

### Authentication (Identity)
- `POST /register` — Create account
- `POST /login` — Obtain JWT

### Models
- `GET /models` — Available audio-separator models with metadata (filename, architecture, output stems, SDR scores). Seeded/cached from the Python worker's model list.

### Workflows
- `POST /workflows` — Save a workflow graph
- `GET /workflows` — List current user's workflows
- `GET /workflows/{id}` — Get a specific workflow

### Execution
- `POST /workflows/{id}/execute` — Submit workflow for execution → creates a Job, enqueues initial steps
- `GET /jobs/{id}` — Job status + step statuses
- `GET /jobs/{id}/results` — Download links for completed stems

### Files
- Upload/download endpoints for audio files (exact shape TBD)

---

## Architecture Notes

### Job Execution Flow
```
Frontend submits workflow
  → API validates DAG
  → Creates Job + JobSteps in DB (status: Pending)
  → Enqueues first step(s) (those with no upstream dependencies) to RabbitMQ
  → Python worker picks up message, processes audio, publishes completion
  → API MassTransit consumer marks step as Completed, writes output paths
  → Consumer enqueues next dependent steps whose dependencies are all done
  → Repeat until all steps complete (Job → Completed) or any step fails (Job → Failed)
```

### MassTransit Message Contract
Messages to the worker carry:
```json
{
  "jobId": "guid",
  "stepId": "guid",
  "inputFilePath": "uploads/abc123/input.wav",
  "modelFilename": "htdemucs_ft.yaml",
  "modelParams": { }
}
```
File paths are **relative to the shared volume mount**, never absolute.

### Model Registry
The API maintains a cached list of available models and their metadata:
- `filename` — model file identifier
- `architecture` — MDX, MDXC, Demucs, or VR
- `outputStems` — array of stem names (e.g. `["vocals", "drums", "bass", "other"]`)
- `sdrScores` — signal-to-distortion ratio scores per stem

This can be seeded from a static JSON file or fetched from the worker on startup.

### Python Worker
- Runs in a **separate container** within the same `docker-compose` stack.
- **No authentication** between API and worker — they trust each other on the internal Docker network.
- Shares the same RabbitMQ instance and file-storage volume with the API.

---

## Folder Structure (Clean Architecture)

```
src/main-api/
├── FluentAudioSplit.Api/           # ASP.NET project
│   ├── Controllers/                # API controllers / minimal-API endpoint groups
│   ├── Middleware/                  # Custom middleware (error handling, etc.)
│   └── Program.cs                  # DI setup, pipeline config
│
├── FluentAudioSplit.Domain/        # Domain layer
│   ├── Entities/                   # User, Workflow, Job, JobStep
│   └── Interfaces/                 # IFileStorage, IJobOrchestrator, repository interfaces
│
├── FluentAudioSplit.Infrastructure/# Infrastructure layer
│   ├── Persistence/                # EF Core DbContext, migrations, repository implementations
│   ├── Messaging/                  # MassTransit consumers and producers
│   └── Storage/                    # IFileStorage implementations (local, S3 later)
│
└── FluentAudioSplit.Contracts/     # Shared DTOs & message contracts
    ├── Messages/                   # MassTransit message types (used by API and worker)
    └── Dtos/                       # Request/response DTOs
```

---

## Important Constraints

1. **No Python in this project.** The API orchestrates via the queue only.
2. **Relative file paths only** in all messages and DB records — relative to the shared Docker volume.
3. **JWT expiry:** 1-hour access tokens. Refresh token support is optional for now.
4. **Async/await everywhere.** No blocking calls (`Task.Result`, `.Wait()`, `GetAwaiter().GetResult()`).
5. **API and worker share** the same RabbitMQ instance and file-storage volume.
6. **Do not roll custom auth.** Use `MapIdentityApi` and the built-in Identity token endpoints.

---

## Docker Setup

| Service | Image | Port(s) |
|---|---|---|
| **api** | Standard ASP.NET Docker image | `5000` |
| **postgres** | `postgres:16` | `5432` |
| **rabbitmq** | `rabbitmq:3-management` | `5672` (AMQP), `15672` (management UI) |
| **python-worker** | Custom (added later) | — |

All services are defined in a single `docker-compose.yml` at the repository root (or `src/`).

---

## Coding Conventions

- Follow standard C# / .NET naming conventions (PascalCase for public members, `_camelCase` for private fields).
- Use **nullable reference types** (`<Nullable>enable</Nullable>`).
- Prefer **minimal APIs** or thin controllers — keep business logic in services/domain layer.
- Register dependencies via `IServiceCollection` extensions per layer (e.g. `AddInfrastructure()`, `AddDomain()`).
- Configuration via `appsettings.json` + environment variables. Use the Options pattern (`IOptions<T>`) for typed config sections.
- Use `FluentValidation` or Data Annotations for request validation.
