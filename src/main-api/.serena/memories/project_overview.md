# Project Overview: fluent-audio-split main-api

## Purpose
C# ASP.NET Core Web API backend for **Fluent Audio Split**. Orchestrates multi-node audio DAG workflow execution. The actual ML inference is performed by a Python worker via RabbitMQ.

## Tech Stack
| Concern | Choice |
|---|---|
| Runtime | .NET 10, ASP.NET Core Web API |
| Auth | ASP.NET Identity + custom JWT (`ITokenService`) |
| Database | SQLite (dev) / PostgreSQL (prod) via EF Core. Code-first migrations. |
| Message Queue | RabbitMQ via MassTransit. Sends `ProcessNodeCommand`; consumes `NodeCompletedEvent`, `NodeStartedEvent`, `NodeFailedEvent`. |
| File Storage | Local filesystem, `IFileStorageProvider` / `LocalFileStorageProvider`. BasePath: `/data/audio` (Docker shared volume). |
| Real-time | Server-Sent Events via singleton `ExecutionEventBus`. |
| Observability | OpenTelemetry (ConsoleExporter for now, OTLP-ready). |
| API Docs | Swagger/Swashbuckle at `/swagger`. |

## Solution Structure
```
src/main-api/
├── FluentAudioSplit.Api/
│   ├── Controllers/         # Workflows, Executions, Files, Models (+ Auth via MapIdentityApi)
│   ├── Consumers/           # NodeStartedConsumer, NodeCompletedConsumer, NodeFailedConsumer
│   ├── Messages/            # ProcessNodeCommand, NodeCompletedEvent, NodeFailedEvent, NodeStartedEvent
│   ├── Dtos/                # WorkflowDtos, ExecutionDtos
│   └── Services/            # ExecutionEventBus (SSE)
├── FluentAudioSplit.Domain/
│   ├── Entities/            # Workflow, WorkflowVersion, WorkflowExecution, NodeExecution, FileRecord
│   └── Models/              # StemDefinitions (model→stems registry), WorkflowNodeDefinition (record)
└── FluentAudioSplit.Infrastructure/
    └── Persistence/         # ApplicationDbContext, Migrations
```

## Domain Entities
- **Workflow** → has many **WorkflowVersion**
- **WorkflowVersion**: `Id`, `WorkflowId`, `VersionNumber`, `StructureJson` (JSON array of `WorkflowNodeDefinition`), `CreatedAt`
- **WorkflowNodeDefinition** (record in `Models/`, not a DB entity): `Id`, `Order`, `NodeType` ("AudioSeparation"), `ConfigJson` (`{modelName}`), `SourceNodeId?`, `SourceOutputName?` — deserialized from `WorkflowVersion.StructureJson`
- **WorkflowExecution** → references `WorkflowVersionId` (snapshot of the structure at execution time) → has many **NodeExecution**
- **NodeExecution**: `WorkflowExecutionId`, `WorkflowNodeId` (logical ID from the version JSON), `Attempt`, `InputArtifactPath`, `OutputArtifactDir`, `OutputArtifactPathsJson` (JSON `{stemName: path}`), `Status`

> **Architecture note**: Workflow nodes are no longer stored as separate DB rows (`WorkflowNode` entity was removed). The graph structure is stored as a JSON blob in `WorkflowVersion.StructureJson`, enabling immutable versioning — each save creates a new version.

## Execution Flow
1. `POST /api/executions` with `{ workflowId, fileRecordId }` → resolves latest `WorkflowVersion`, deserializes `StructureJson` into `WorkflowNodeDefinition[]`, creates `WorkflowExecution` + `NodeExecution` rows for root nodes (SourceNodeId = null), dispatches `ProcessNodeCommand`
2. `NodeCompletedConsumer` → marks node done, finds downstream nodes (SourceNodeId = completedNodeId) from the version's structure JSON, creates their `NodeExecution`s, dispatches new `ProcessNodeCommand`
3. Completion check: workflow execution is done when ALL nodes in the version have a completed `NodeExecution`

## Key Notes
- `StemDefinitions.ModelStems` (Domain/Models) must be kept in sync with worker `models.py` and frontend `lib/models.ts`
- Model filenames **must** include extension (`htdemucs_ft.yaml`, `UVR-MDX-NET-Inst_HQ_3.onnx`, `vocals_mel_band_roformer.ckpt`)
- `WorkflowsController.Update` saves a new `WorkflowVersion` with the full node graph as JSON (no separate node rows to upsert/delete)

## Auth Endpoints
- `POST /api/auth/register` — `{ email, password }`
- `POST /api/auth/login` — `{ email, password }` → `{ accessToken, … }`

## Docker Config
- `docker compose up --build` from repo root
- API port: 8080, DB in `api-data` volume, audio in `shared-audio` volume
- Env: `RabbitMq__Host`, `RabbitMq__Username`, `RabbitMq__Password`, `ConnectionStrings__DefaultConnection`
