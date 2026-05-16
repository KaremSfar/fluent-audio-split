# Project Overview: fluent-audio-split Frontend

## Purpose
React SPA for **Fluent Audio Split** — an audio stem separation app. Users upload audio files, build multi-node DAG workflows (each node runs an ML separation model), execute them, and stream real-time progress.

## Tech Stack
- **Framework**: React 19 + TypeScript via Vite
- **Styling**: Tailwind CSS v3
- **UI Components**: shadcn/ui (New York style, Violet theme) — in `src/components/ui/`
- **Forms**: react-hook-form + Zod
- **HTTP Client**: Axios via `src/services/apiClient.ts`
- **Routing**: React Router v7
- **Server State**: TanStack Query (React Query v5)
- **SSE**: `@microsoft/fetch-event-source` for execution progress streaming
- **Telemetry**: OpenTelemetry — `src/telemetry/otel.ts`

## Folder Structure
```
src/
  auth/           # AuthContext, authService, useAuth hook
  components/ui/  # shadcn/ui components
  hooks/          # useExecutionStream (SSE hook)
  lib/            # models.ts (MODEL_DEFINITIONS, getStemsForModel, STEM_COLORS), utils.ts
  pages/          # Route-level components (see Routes below)
  services/       # apiClient, workflowsService, executionsService, filesService
  types/          # workflow.ts, execution.ts, file.ts, auth.ts
```

## Routes
- `/login` → LoginPage
- `/register` → RegisterPage
- `/dashboard` → DashboardPage
- `/files` → FilesPage (upload + list)
- `/workflows/new` → NewWorkflowPage
- `/workflows/:id/canvas` → WorkflowCanvasPage (DAG editor)
- `/executions` → ExecutionsListPage
- `/executions/:id` → ExecutionPage (live progress + results)

## Key Concepts

### WorkflowCanvasPage (DAG editor)
- Nodes are displayed in a tree layout (grouped by depth level)
- Each node card shows model selector + stem output buttons
- Clicking a stem button adds a child node connected via that stem
- New nodes get `id: "new:<uuid>"` locally; on save, `id` is omitted so the API inserts them
- `saveMutation` strips `new:` prefix IDs before sending to API

### MODEL_DEFINITIONS (src/lib/models.ts)
- Hardcoded list of models with their stems and display colors
- Must be kept in sync with API (`StemDefinitions.cs`) and worker (`models.py`)
- Model values are full filenames incl. extension: `htdemucs_ft.yaml`, `UVR-MDX-NET-Inst_HQ_3.onnx`, etc.

### useExecutionStream (src/hooks/useExecutionStream.ts)
- Connects to `GET /api/executions/{id}/stream` (SSE)
- Emits node lifecycle events (started/completed/failed)
- `outputPaths` is `Record<string, string>` (stemName → relativePath)

## Environment Variables
- `VITE_SERVICE_URL` — Backend API base URL (default: `http://localhost:8080`)
- Copy `.env.example` to `.env.development` before running locally
