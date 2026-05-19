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
- **Graph/Canvas**: React Flow (`@xyflow/react`) + dagre (`@dagrejs/dagre`) for auto-layout
- **SSE**: `@microsoft/fetch-event-source` for execution progress streaming
- **Telemetry**: OpenTelemetry — `src/telemetry/otel.ts`

## Folder Structure
```
src/
  auth/           # AuthContext, authService, useAuth hook
  components/     # AudioSeparationNode (custom React Flow node)
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

### WorkflowCanvasPage (DAG editor — React Flow)
- Uses **React Flow** (`@xyflow/react`) for the node graph with automatic **dagre** layout
- Custom node type: `AudioSeparationNode` (registered as `audioSeparation` in `nodeTypes`)
- Layout function `layoutWithDagre` computes node positions (top-to-bottom, `rankdir: TB`)
- `toRF` / `fromRF` convert between API `WorkflowNodeDefinition[]` and React Flow nodes/edges
- `ExecuteDialog` allows selecting an input file to execute the workflow
- Node callbacks (`onConfigChange`, `onRemove`) passed via `NodeCallbacksContext`
- Each node card shows model selector + stem output buttons; clicking a stem adds a child edge
- Save creates a new `WorkflowVersion` with the serialized node graph

### advancedParams (src/lib/advancedParams.ts + AdvancedParamsModal.tsx)
- Every `AudioSeparationNode` has an "⚙ Advanced" button (tiny, in the model label row)
- Opens a portal modal showing only params relevant to the selected model's arch
- `ModelArch` = `'demucs' | 'mdx' | 'vr' | 'mdxc'` (Roformer/MelBand models use `mdxc`)
- `PARAM_GROUPS`: common (7 params) + arch-specific (MDX 5, VR 7, Demucs 4, MDXC 5)
- Params stored flat in `configJson.advancedParams = { output_format, normalization_threshold, ... }`
- Worker reads `advancedParams`, maps to `Separator()` constructor kwargs + arch param dicts (local) or flat kwargs (remote)
- Each param has a tooltip icon (ⓘ) showing the CLI description on hover

### MODEL_DEFINITIONS (src/lib/models.ts)
- Hardcoded list of models with their stems, display colors, and `arch` field
- `arch: ModelArch` added to `ModelDefinition` — determines which Advanced Params group to show
- Must be kept in sync with API (`StemDefinitions.cs`) and worker (`models.py`)
- Model values are full filenames incl. extension: `htdemucs_ft.yaml`, `UVR-MDX-NET-Inst_HQ_3.onnx`, etc.

### useExecutionStream (src/hooks/useExecutionStream.ts)
- Connects to `GET /api/executions/{id}/stream` (SSE)
- Emits node lifecycle events (started/completed/failed)
- `outputPaths` is `Record<string, string>` (stemName → relativePath)

## Environment Variables
- `VITE_SERVICE_URL` — Backend API base URL (default: `http://localhost:8080`)
- Copy `.env.example` to `.env.development` before running locally
