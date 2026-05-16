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
│   ├── Entities/            # Workflow, WorkflowNode, WorkflowExecution, NodeExecution, FileRecord
│   └── Models/              # StemDefinitions (model→stems registry)
└── FluentAudioSplit.Infrastructure/
    └── Persistence/         # ApplicationDbContext, Migrations
```

## Domain Entities
- **Workflow** → has many **WorkflowNode**
- **WorkflowNode**: `Id`, `WorkflowId`, `Order`, `NodeType` ("AudioSeparation"), `ConfigJson` (`{modelName}`), `SourceNodeId?` (FK to parent node), `SourceOutputName?` (stem name from parent)
- **WorkflowExecution** → has many **NodeExecution**
- **NodeExecution**: `WorkflowNodeId`, `InputArtifactPath`, `OutputArtifactDir`, `OutputArtifactPaths` (JSON `{stemName: path}`), `Status`

## Execution Flow
1. `POST /api/workflows/{id}/execute` → creates `WorkflowExecution` + `NodeExecution` rows for root nodes (SourceNodeId = null), dispatches `ProcessNodeCommand`
2. `NodeCompletedConsumer` → marks node done, finds downstream nodes (SourceNodeId = completedNodeId), creates their `NodeExecution`s, dispatches new `ProcessNodeCommand`
3. Completion check: workflow is done when ALL nodes have a completed `NodeExecution`

## Key Notes
- `StemDefinitions.ModelStems` (Domain/Models) must be kept in sync with worker `models.py` and frontend `lib/models.ts`
- Model filenames **must** include extension (`htdemucs_ft.yaml`, `UVR-MDX-NET-Inst_HQ_3.onnx`, `vocals_mel_band_roformer.ckpt`)
- `WorkflowsController.Update` uses `ExecuteUpdateAsync`/`ExecuteDeleteAsync` (bulk SQL) to avoid EF concurrency issues

## Auth Endpoints
- `POST /api/auth/register` — `{ email, password }`
- `POST /api/auth/login` — `{ email, password }` → `{ accessToken, … }`

## Docker Config
- `docker compose up --build` from repo root
- API port: 8080, DB in `api-data` volume, audio in `shared-audio` volume
- Env: `RabbitMq__Host`, `RabbitMq__Username`, `RabbitMq__Password`, `ConnectionStrings__DefaultConnection`
