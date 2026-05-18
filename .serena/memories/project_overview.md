# Project Overview: fluent-audio-split (monorepo root)

## Purpose
**Fluent Audio Split** — an audio stem separation app. Users build visual DAG workflows chaining ML models to progressively split audio into stems, and stream execution progress in real time.

## Architecture
```
React SPA (port 3000) ↔ C# ASP.NET API (port 8080) ↔ RabbitMQ ↔ Python Worker
                              │                                        │
                       SQLite (dev)                      Shared Docker volume /data/audio
                       PostgreSQL (prod)
```

## Monorepo Structure
```
/
├── docker-compose.yml          # Full-stack orchestration
├── README.md
└── src/
    ├── front/                  # React 19 + TypeScript + Vite + React Flow
    ├── main-api/               # ASP.NET Core .NET 10, EF Core, MassTransit
    └── audio-separation-worker/ # Python 3.12, kombu, audio-separator
```

Each sub-project has its own Dockerfile and is configured as a separate Serena project (`front`, `main-api`, `audio-separation-worker`).

## Key Design Decisions
- **Workflow versioning**: Workflow graph structure stored as JSON in `WorkflowVersion.StructureJson` (not as individual DB rows). Each save creates a new version.
- **Executions reference a version**: `WorkflowExecution.WorkflowVersionId` ensures the executed graph is immutable.
- **Model registry sync**: Model→stems mapping duplicated in 3 places that must stay in sync:
  - `src/audio-separation-worker/app/models.py` (Python)
  - `src/main-api/FluentAudioSplit.Domain/Models/StemDefinitions.cs` (C#)
  - `src/front/src/lib/models.ts` (TypeScript)
- **Relative file paths**: All file references in DB/messages are relative to the shared volume mount.

## Services (Docker Compose)
| Service | Port | Image/Build |
|---|---|---|
| `front` | 3000:80 | `./src/front` |
| `api` | 8080:8080 | `./src/main-api` |
| `worker` | — | `./src/audio-separation-worker` |
| `rabbitmq` | 15672 (mgmt), 5672 (amqp) | `rabbitmq:3.13-management-alpine` |

Volumes: `api-data` (SQLite DB), `shared-audio` (audio files shared between API and worker).
