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
| **Database** | SQLite via EF Core (will migrate to PostgreSQL) | Code-first migrations. In Docker: `/data/fluent_audio_split.db` (named volume). Locally: `fluent_audio_split.db` next to the binary. |
| **Message Queue** | RabbitMQ via **MassTransit** | `ProcessNodeCommand` sent to `queue:process-node`. `NodeCompletedEvent` / `NodeFailedEvent` consumed by `NodeCompletedConsumer` / `NodeFailedConsumer`. |
| **File Storage** | Local filesystem via `IFileStorageProvider` / `LocalFileStorageProvider` | Abstracted so S3 can be swapped in later. BasePath configured via `FileStorage:BasePath` (default `/data/audio`). |
| **Real-time** | Server-Sent Events via `ExecutionEventBus` | Singleton in-process event bus; streams execution progress via `/api/executions/{id}/stream`. |
| **Observability** | OpenTelemetry (`OpenTelemetry.Extensions.Hosting`) | TracerProvider + MeterProvider. Currently using `ConsoleExporter`. OTLP exporter is commented out pending collector setup. |
| **Logging** | `Microsoft.Extensions.Logging` | Structured logging via ILogger<T>. |
| **API Docs** | Swagger / Swashbuckle | Available at `/swagger` in Development. |

---

## Solution Structure

```
src/main-api/
├── FluentAudioSplit.slnx                    ← Solution file (.NET 10 slnx format)
├── FluentAudioSplit.Api/                    ← ASP.NET Web API project
│   ├── Consumers/
│   │   ├── NodeStartedConsumer.cs           ← MassTransit: handles NodeStartedEvent
│   │   ├── NodeCompletedConsumer.cs         ← MassTransit: chains downstream nodes + completes execution
│   │   └── NodeFailedConsumer.cs            ← MassTransit: handles NodeFailedEvent
│   ├── Controllers/
│   │   ├── AuthController.cs               ← POST /api/auth/register, POST /api/auth/login
│   │   ├── ExecutionsController.cs         ← /api/executions (CRUD + SSE stream + retry + cancel)
│   │   ├── ExecutionResultsController.cs   ← /api/executions/{id}/results (+ /tracks add/remove)
│   │   ├── FilesController.cs              ← /api/files (upload, list, delete, download)
│   │   ├── ModelsController.cs             ← GET /api/models (list available models + stems)
│   │   └── WorkflowsController.cs          ← /api/workflows (CRUD + execute)
│   ├── Dtos/
│   │   ├── ExecutionDtos.cs                ← NodeExecutionDto, WorkflowExecutionDto, StartExecutionRequest
│   │   └── WorkflowDtos.cs                 ← FileRecordDto, WorkflowNodeDto, WorkflowDto, CreateWorkflowRequest
│   ├── Messages/
│   │   ├── NodeStartedEvent.cs             ← Published by Python worker when node begins
│   │   ├── NodeCompletedEvent.cs           ← Published by Python worker when node finishes
│   │   ├── NodeFailedEvent.cs              ← Published by Python worker on failure
│   │   └── ProcessNodeCommand.cs           ← Sent to queue:process-node to trigger Python worker
│   ├── Services/
│   │   ├── ExecutionEventBus.cs            ← Singleton SSE event bus (ConcurrentDictionary + Channel)
│   │   ├── NodeDispatcher.cs               ← ONLY place that builds NodeExecution + ProcessNodeCommand (+ input resolution / Merge join)
│   │   ├── ResultTrackService.cs           ← Seeds/queries/edits ResultTrack rows, builds ExecutionResultsDto
│   │   └── WorkflowMapping.cs              ← Shared entity → DTO mapping
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
├── FluentAudioSplit.Domain/                 ← Class library: entities + enums
│   ├── Models/
│   │   ├── StemDefinitions.cs              ← Static model→stems registry
│   │   ├── NodeTypes.cs                    ← "AudioSeparation" | "Merge", Merge output name "Mix"
│   │   ├── WorkflowNodeDefinition.cs       ← Node in StructureJson: Id, Order, NodeType, ConfigJson, Inputs[], KeptOutputs[]
│   │   ├── MergeNodeConfig.cs              ← Merge ConfigJson shape (label, inputGainsDb, levelMode, ceilingDb)
│   │   ├── WorkflowGraph.cs                ← Pure: Validate (V1–V9), Dependents, IsConsumed, HasExplicitKeeps
│   │   └── WorkflowJson.cs                 ← camelCase (de)serialization of StructureJson
│   └── Entities/
│       ├── ApplicationUser.cs              ← Extends IdentityUser
│       ├── FileRecord.cs                   ← Uploaded audio file metadata
│       ├── NodeExecution.cs                ← Single node run within a WorkflowExecution (NodeType, InputArtifactPath / InputArtifactsJson)
│       ├── ResultTrack.cs                  ← A stem in an execution's results (Kept | Default | Manual)
│       ├── NodeExecutionStatus.cs          ← Enum: Pending, Queued, Running, Completed, Failed, Cancelled
│       ├── Workflow.cs                     ← Workflow template (has Nodes collection)
│       ├── WorkflowExecution.cs            ← A run of a Workflow against an input file
│       ├── WorkflowExecutionStatus.cs      ← Enum: Pending, Running, Completed, PartiallyFailed, Failed, Cancelled
│
└── FluentAudioSplit.Infrastructure/        ← Class library: EF Core, storage
    ├── Persistence/
    │   ├── ApplicationDbContext.cs         ← IdentityDbContext<ApplicationUser> with all DbSets
    │   ├── MigrationsService.cs            ← IHostedService: runs MigrateAsync on startup
    │   └── Migrations/                     ← EF Core migrations (single fresh InitialCreate; DB was reset for the Merge/Results release)
    └── Storage/
        ├── IFileStorageProvider.cs         ← Abstraction: Read/Write/Exists/List/Delete
        └── LocalFileStorageProvider.cs     ← Local filesystem implementation
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

## Tests

```bash
cd src/main-api && dotnet test      # FluentAudioSplit.Tests (xUnit): WorkflowGraph, consumer/join (incl. concurrent
                                    # Merge-parent completion), ResultTrackService, controllers. Uses a temp SQLite file with real migrations.
```

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

## Files Endpoints (`/api/files`)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/files/upload` | Multipart file upload → saves to `IFileStorageProvider`, creates `FileRecord` |
| `GET` | `/api/files` | List current user's files |
| `DELETE` | `/api/files/{id}` | Delete file record + storage file |
| `GET` | `/api/files/download?path=...` | Stream file back; checks ownership via `FileRecord` or `NodeExecution.OutputArtifactDir` |

---

## Workflows Endpoints (`/api/workflows`)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/workflows` | Create workflow with nodes (validated; 400 `ValidationProblemDetails` with `errors.nodes`) |
| `PATCH` | `/api/workflows/{id}` | New version; client-supplied node ids are kept as given |
| `POST` | `/api/workflows/{id}/execute` | Validates, seeds explicit keeps, dispatches root nodes |
| `GET` | `/api/workflows` | List current user's workflows |
| `GET` | `/api/workflows/{id}` | Get single workflow with nodes |
| `DELETE` | `/api/workflows/{id}` | Delete workflow |

`CreateWorkflowRequest`:
```json
{
  "name": "My Pipeline",
  "nodes": [
    { "id": "<client guid>", "order": 0, "nodeType": "AudioSeparation", "configJson": "{\"modelName\":\"htdemucs_ft.yaml\"}",
      "inputs": [], "keptOutputs": ["Drums"] },
    { "id": "<client guid>", "order": 1, "nodeType": "Merge", "configJson": "{\"label\":\"Mix\",\"inputGainsDb\":[0,-3]}",
      "inputs": [{ "sourceNodeId": "<guid>", "sourceOutputName": "Vocals" }, { "sourceNodeId": "<guid>", "sourceOutputName": "Bass" }],
      "keptOutputs": ["Mix"] }
  ]
}
```

Graph model: a node has `inputs[]` (multi-input). `AudioSeparation` has 0–1 inputs (0 = uploaded file), `Merge` has 2–8 and always
outputs `"Mix"`. `keptOutputs` pins outputs as results. Rules V1–V9 live in `WorkflowGraph.Validate` (mirrored in the frontend).

---

## Executions Endpoints (`/api/executions`)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/executions/workflows/{workflowId}/execute` | Start execution with `{ "fileId": "..." }` → sends `ProcessNodeCommand` to RabbitMQ |
| `GET` | `/api/executions` | List user's executions |
| `GET` | `/api/executions/{id}` | Get execution detail |
| `GET` | `/api/executions/{id}/stream` | SSE stream of execution events |
| `POST` | `/api/executions/{id}/nodes/{nodeExecId}/retry` | Retry a failed node (creates new `NodeExecution`) |
| `GET` | `/api/executions/{id}/results` | `ExecutionResultsDto`: tracks (with resolved state/path) + available stems |
| `POST` | `/api/executions/{id}/results/tracks` | Add a manual track `{ workflowNodeId, outputName }` → 201 / 409 duplicate / 400 not a completed output |
| `DELETE` | `/api/executions/{id}/results/tracks/{trackId}` | Remove a track → 204 |

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
  "RabbitMq": {
    "Host": "localhost",
    "Username": "guest",
    "Password": "guest"
  },
  "FileStorage": {
    "BasePath": "/data/audio"
  },
  "OpenTelemetry": {
    "Endpoint": "http://localhost:4317"
  }
}
```

**In production**, override secrets via environment variables (double-underscore syntax): `JwtSettings__Secret`, `RabbitMq__Password`, etc.

---

## Domain Entities

### ApplicationUser
Extends `IdentityUser`. Adds `CreatedAt` timestamp.

### Workflow
Template owned by a user. Has `ICollection<WorkflowNode> Nodes`.

### Workflow nodes
There is no `WorkflowNode` entity: nodes are `WorkflowNodeDefinition` objects serialized (camelCase) into `WorkflowVersion.StructureJson`.

### ResultTrack
`(WorkflowExecutionId, WorkflowNodeId, OutputName)` unique. `Origin`: `Kept` (seeded at execute from `keptOutputs`),
`Default` (added on node completion when NO node has explicit keeps: every output nobody consumes), `Manual` (added via API).
The artifact path is resolved at query time from the latest attempt, so retries are reflected automatically.

### FileRecord
Uploaded audio file metadata: `OriginalFileName`, `StoragePath` (relative), `ContentType`, `SizeBytes`.

### WorkflowExecution
A single run of a Workflow against an input `FileRecord`. Status progresses: `Pending → Running → Completed | PartiallyFailed | Failed | Cancelled`.

### NodeExecution
A single step execution within a `WorkflowExecution`. Tracks `NodeType`, `InputArtifactPath` (Split) / `InputArtifactsJson` (Merge),
`OutputArtifactDir`, `Attempt`, `Status`, timestamps. Unique index `(WorkflowExecutionId, WorkflowNodeId, Attempt)` is the
race-safety backstop for dispatch.

### WorkflowExecutionStatus
`Pending, Running, Completed, PartiallyFailed, Failed, Cancelled`

### NodeExecutionStatus
`Pending, Queued, Running, Completed, Failed, Cancelled`

---

## Architecture: Execution Flow

```
Frontend POSTs /api/workflows/{id}/execute
  → API validates the graph, creates WorkflowExecution (Running), seeds Kept ResultTracks
  → NodeDispatcher creates a NodeExecution (Queued) + sends ProcessNodeCommand for each ROOT node
  → Returns WorkflowExecutionDto

Python worker processes audio
  → Publishes NodeCompletedEvent or NodeFailedEvent to RabbitMQ

NodeCompletedConsumer (MassTransit)
  → Updates NodeExecution.Status = Completed, sets OutputArtifactDir
  → Default-mode: inserts Default ResultTracks for unconsumed outputs
  → For each dependent node: join check (every input's source latest attempt Completed AND the named output exists)
      · inputs not all ready  → wait (a later parent completion re-checks)
      · named output missing  → dependent is recorded Failed (no "first output" fallback)
      · otherwise             → NodeDispatcher.DispatchAsync (race-safe via the unique index; a losing concurrent
                                 consumer's insert fails and is skipped → exactly one Merge execution)
  → ExecutionReconciler settles the terminal status once nothing is in flight
  → Publishes to ExecutionEventBus (SSE subscribers notified)

NodeFailedConsumer (MassTransit)
  → Updates NodeExecution.Status = Failed, sets ErrorMessage
  → Sets WorkflowExecution.Status = PartiallyFailed
  → Publishes to ExecutionEventBus (SSE subscribers notified)

Frontend GET /api/executions/{id}/stream (SSE)
  → Receives real-time events: NodeCompleted, NodeFailed, ExecutionCompleted, ExecutionPartiallyFailed
```

## ExecutionEventBus (SSE)

- Singleton service holding `ConcurrentDictionary<Guid, List<ChannelWriter<string>>>`.
- `PublishAsync(executionId, payload)` — serializes payload to JSON, writes to all subscribed channels.
- `StreamAsync(executionId, ct)` — `IAsyncEnumerable<string>` backed by an unbounded `Channel<string>`. Cleans up on disconnect.
- Used by `NodeCompletedConsumer` and `NodeFailedConsumer` to push events.
- Served via `TypedResults.ServerSentEvents` in `ExecutionsController.StreamExecution`.

## MassTransit Messages

### ProcessNodeCommand (sent by API → Python worker)
```json
{
  "workflowExecutionId": "guid",
  "nodeExecutionId": "guid",
  "nodeType": "AudioSeparation | Merge",
  "inputArtifactPath": "uploads/userId/fileId/audio.wav",   // AudioSeparation only ("" for Merge)
  "inputArtifacts": [{ "path": "...", "label": "Vocals", "gainDb": 0.0 }],   // Merge only, ordered as node inputs
  "outputArtifactDir": "executions/execId/nodes/nodeId/",
  "configJson": "{}",
  "trimStartSeconds": null, "trimEndSeconds": null           // root AudioSeparation only
}
```
Always build commands through `NodeDispatcher` — never inline.

### NodeCompletedEvent (published by Python worker → consumed by NodeCompletedConsumer)
```json
{
  "workflowExecutionId": "guid",
  "nodeExecutionId": "guid",
  "outputArtifactPaths": { "Vocals": "executions/.../stems/Vocals.wav", "Drums": "..." }
}
```

### NodeFailedEvent (published by Python worker → consumed by NodeFailedConsumer)
```json
{
  "workflowExecutionId": "guid",
  "nodeExecutionId": "guid",
  "errorMessage": "...",
  "isTransient": false
}
```

File paths are **relative to the shared storage base path**, never absolute.

---

## OpenTelemetry Setup

- Traces: `AddAspNetCoreInstrumentation` + `AddHttpClientInstrumentation` → **ConsoleExporter** (for now)
- Metrics: `AddAspNetCoreInstrumentation` → **ConsoleExporter** (for now)
- To switch to OTLP: uncomment the `AddOtlpExporter` line in `Startup.cs` and ensure the collector is running on `OpenTelemetry:Endpoint`.

---

## Important Constraints

1. **No Python in this project.** The API orchestrates via the queue only.
2. **Relative file paths only** in all messages and DB records.
3. **JWT expiry:** 1-hour access tokens.
4. **Async/await everywhere.** No blocking calls (`Task.Result`, `.Wait()`, `GetAwaiter().GetResult()`).
5. **Do NOT roll custom password hashing.** Use ASP.NET Identity (`UserManager`, `SignInManager`).
6. **All controllers** use `[Route("api/[controller]")]` prefix (except `ExecutionsController` / `ExecutionResultsController` which use `api/executions...`).
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

## Docker Setup

`docker compose up --build` from repo root starts:

| Service | Build context | Port(s) | Notes |
|---|---|---|---|
| **api** | `src/main-api` | `8080` | Multi-stage .NET 10 build → aspnet runtime |
| **front** | `src/front` | `3000` | Node build → nginx |

SQLite database is stored in Docker named volume `api-data`, mounted at `/data` inside the container.  
Connection string env override: `ConnectionStrings__DefaultConnection=Data Source=/data/fluent_audio_split.db`

Planned additions: RabbitMQ service, Python worker service in docker-compose.

