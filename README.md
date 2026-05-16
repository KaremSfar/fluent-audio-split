# Fluent Audio Split

An audio stem separation app built around [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator). Users build visual DAG (directed acyclic graph) workflows — chaining ML models to progressively split audio into stems — and stream execution progress in real time.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  React SPA  │────▶│  C# ASP.NET API  │────▶│  RabbitMQ    │────▶│  Python Worker  │
│  Port 3000  │◀────│  Port 8080       │◀────│  (queue)     │◀────│ audio-separator │
└─────────────┘     └──────────────────┘     └──────────────┘     └─────────────────┘
                             │                                              │
                      SQLite (dev)                             Shared Docker volume
                      PostgreSQL (prod)                        /data/audio
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, Vite, Shadcn/ui, TanStack Query |
| API | ASP.NET Core (.NET 10), ASP.NET Identity, JWT, EF Core |
| Database | SQLite (dev) → PostgreSQL (prod) |
| Worker | Python 3.12, `audio-separator` (CPU inference) |
| Queue | RabbitMQ + MassTransit |
| Observability | OpenTelemetry (console now, OTLP-ready) |

## Quick Start (Docker)

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| API + Swagger | http://localhost:8080 / http://localhost:8080/swagger |
| RabbitMQ management | http://localhost:15672 (guest / guest) |

---

## Project Structure

```
src/
├── front/                               # React SPA
│   └── src/
│       ├── auth/                        # AuthContext, JWT handling
│       ├── hooks/                       # useExecutionStream (SSE)
│       ├── lib/                         # models.ts (MODEL_DEFINITIONS), utils.ts
│       ├── pages/                       # Login, Register, Dashboard, Canvas, Execution pages
│       ├── services/                    # Axios API client wrappers
│       └── types/                       # workflow.ts, execution.ts TypeScript types
├── main-api/
│   ├── FluentAudioSplit.Api/            # Controllers, Consumers, Messages, DTOs, Startup
│   ├── FluentAudioSplit.Auth/           # TokenService, JWT generation
│   ├── FluentAudioSplit.Domain/         # Entities, StemDefinitions model registry
│   └── FluentAudioSplit.Infrastructure/ # EF Core DbContext, migrations
└── audio-separation-worker/
    └── app/
        ├── models.py                    # MODEL_STEMS registry (model filename → stem list)
        ├── handlers.py                  # ProcessNodeCommand handler, runs audio-separator
        ├── consumer.py                  # RabbitMQ consumer (MassTransit wire format)
        ├── publisher.py                 # Publishes NodeStarted/Completed/Failed events
        └── storage.py                   # Shared file storage helper
```

---

## Core Concepts

### Workflow DAG

A **Workflow** is a directed acyclic graph of **nodes**. Each node is an `AudioSeparation` operation that runs one ML model against one audio input. Nodes are connected by their stems:

- The **root node** takes the user-uploaded file as input (`sourceNodeId = null`).
- Each subsequent node declares a **source node + source output name** (a stem), e.g. "take the `Vocals` output of node A and run it through model B".
- All nodes have exactly **one input**.

### Supported Models

| Model file | Stems produced |
|---|---|
| `htdemucs_ft.yaml` | Vocals, Drums, Bass, Other |
| `htdemucs.yaml` | Vocals, Drums, Bass, Other |
| `htdemucs_6s.yaml` | Vocals, Drums, Bass, Other, Guitar, Piano |
| `UVR-MDX-NET-Inst_HQ_3.onnx` | Vocals, Instrumental |
| `vocals_mel_band_roformer.ckpt` | Vocals, Other |

Model filenames must include their extension — they are passed directly to `separator.load_model()`.

The model→stem registry is kept in sync across three locations:
- `src/audio-separation-worker/app/models.py` — `MODEL_STEMS` dict (Python worker)
- `src/main-api/FluentAudioSplit.Domain/Models/StemDefinitions.cs` — `StemDefinitions.ModelStems` (C# API)
- `src/front/src/lib/models.ts` — `MODEL_DEFINITIONS` array (React frontend)

### Execution Flow

1. User uploads an audio file via the **Files** page.
2. User builds a workflow in the **Canvas** editor — adds nodes, connects stems.
3. User triggers execution — the API dispatches `ProcessNodeCommand` for all root nodes.
4. Python worker separates audio, names outputs via `output_names` dict, publishes `NodeCompletedEvent` with a `{ stemName → relativePath }` map.
5. `NodeCompletedConsumer` (C# API) finds downstream nodes connected via that stem and dispatches new `ProcessNodeCommand` messages (recursive chaining).
6. Frontend streams real-time progress via SSE (`GET /api/executions/{id}/stream`).

---

## API Endpoints

All endpoints require `Authorization: Bearer <jwt>` unless noted.

### Auth
| Method | Route | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register new user |
| `POST` | `/api/auth/login` | Login, returns JWT |

### Files
| Method | Route | Description |
|---|---|---|
| `POST` | `/api/files/upload` | Upload audio file (multipart/form-data) |
| `GET` | `/api/files` | List user's uploaded files |
| `GET` | `/api/files/download?path=…` | Download a file by relative path |
| `DELETE` | `/api/files/{id}` | Delete a file record |

### Workflows
| Method | Route | Description |
|---|---|---|
| `POST` | `/api/workflows` | Create workflow |
| `GET` | `/api/workflows` | List user's workflows |
| `GET` | `/api/workflows/{id}` | Get workflow with nodes |
| `PATCH` | `/api/workflows/{id}` | Update workflow name + nodes (upsert) |
| `DELETE` | `/api/workflows/{id}` | Delete workflow |
| `POST` | `/api/workflows/{id}/execute` | Execute workflow |

### Executions
| Method | Route | Description |
|---|---|---|
| `GET` | `/api/executions` | List user's executions |
| `GET` | `/api/executions/{id}` | Get execution details |
| `GET` | `/api/executions/{id}/stream` | SSE stream of node lifecycle events |
| `GET` | `/api/executions/{id}/results` | Final stem output paths |
| `POST` | `/api/executions/{id}/nodes/{nodeExecId}/retry` | Retry a failed node |

### Models
| Method | Route | Description |
|---|---|---|
| `GET` | `/api/models` | List available models and their stems |

---

## Local Development (without Docker)

### API
```bash
cd src/main-api
dotnet ef database update \
  --project FluentAudioSplit.Infrastructure \
  --startup-project FluentAudioSplit.Api \
  --context ApplicationDbContext
dotnet run --project FluentAudioSplit.Api --launch-profile http
# API    → http://localhost:8080
# Swagger → http://localhost:8080/swagger
```

### Frontend
```bash
cd src/front
cp .env.example .env.development   # set VITE_SERVICE_URL=http://localhost:8080
npm install
npm run dev
# → http://localhost:5173
```

### Python Worker
```bash
cd src/audio-separation-worker
pip install -r requirements.txt
RABBITMQ_HOST=localhost python -m app.consumer
```

---

## Status

- [x] Auth — register / login / JWT
- [x] File upload, list, download, delete
- [x] Workflow CRUD with multi-node DAG canvas editor
- [x] Multi-model audio separation (Demucs, MDX, Roformer)
- [x] Node chaining — stem outputs as inputs to downstream nodes
- [x] Real-time execution progress (SSE)
- [x] Node retry on failure
- [x] Docker Compose full-stack setup
