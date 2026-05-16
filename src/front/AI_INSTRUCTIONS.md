# Fluent Audio Split — Frontend AI Instructions

## Overview
React SPA for an audio stem separation app. Users build multi-node DAG workflows, execute them, and stream real-time progress. Each node runs an ML separation model and produces named stem outputs that can be piped into downstream nodes.

## Setup
```bash
cp .env.example .env.development   # set VITE_SERVICE_URL=http://localhost:8080
npm install
npm run dev   # → http://localhost:5173
npm run build # production build
```

## Tech Stack
| Tool | Details |
|---|---|
| Framework | React 19 + TypeScript via Vite |
| Styling | Tailwind CSS v3 |
| UI Components | shadcn/ui (New York style, Violet theme) — `src/components/ui/` |
| Forms | react-hook-form + Zod |
| HTTP Client | Axios — `src/services/apiClient.ts` |
| Routing | React Router v7 |
| Server State | TanStack Query v5 |
| SSE | `@microsoft/fetch-event-source` |
| Telemetry | OpenTelemetry — `src/telemetry/otel.ts` |

To add shadcn components: `npx shadcn@latest add <component>`

## Folder Structure
```
src/
  auth/           # AuthContext, authService, useAuth
  components/ui/  # shadcn/ui components
  hooks/          # useExecutionStream (SSE)
  lib/            # models.ts, utils.ts
  pages/          # Route-level components
  services/       # apiClient, workflowsService, executionsService, filesService
  types/          # workflow.ts, execution.ts, file.ts, auth.ts
```

## Pages / Routes
| Route | Page | Purpose |
|---|---|---|
| `/login` | LoginPage | JWT login |
| `/register` | RegisterPage | Register |
| `/dashboard` | DashboardPage | Overview |
| `/files` | FilesPage | Upload + list audio files |
| `/workflows/new` | NewWorkflowPage | Create workflow (name only) |
| `/workflows/:id/canvas` | WorkflowCanvasPage | DAG canvas editor |
| `/executions` | ExecutionsListPage | List executions |
| `/executions/:id` | ExecutionPage | Live progress + stem results |

## Key Implementation Details

### WorkflowCanvasPage (DAG Editor)
- Local state: `localNodes: WorkflowNode[]` — mirrors server nodes + unsaved additions
- New nodes created locally get `id: "new:<uuid>"` to mark them as unsaved
- **Save logic** (`saveMutation`): nodes with `new:` prefix send `id: undefined` so the API inserts them; persisted nodes send their real UUID for update
- `sourceNodeId` pointing to another new node is sent as `null` (can't resolve FK for unsaved parent — user must save top-down)
- After save: `onSuccess` replaces `localNodes` with server response (real IDs replace temp IDs)
- Node layout: `buildLevels()` groups nodes by tree depth → rendered as horizontal rows
- Cascade delete: `getDescendantIds()` recursively collects all child IDs

### models.ts (src/lib/models.ts)
- `MODEL_DEFINITIONS`: array of `{ value, label, stems }` — model filenames incl. extension
- `getStemsForModel(modelName)`: returns stem list for a model
- `STEM_COLORS`: maps stem name → Tailwind bg color class
- **Must be kept in sync** with `StemDefinitions.cs` (API) and `models.py` (worker)

### useExecutionStream (src/hooks/useExecutionStream.ts)
- Wraps SSE connection to `GET /api/executions/{id}/stream`
- `outputPaths` field in events is `Record<string, string>` (stemName → relativePath)

## TypeScript Types
```ts
// workflow.ts
WorkflowNode { id, order, nodeType, configJson, sourceNodeId, sourceOutputName }
UpdateWorkflowNodeRequest { id?, order, nodeType, configJson, sourceNodeId, sourceOutputName }

// execution.ts
NodeExecutionDto { outputArtifactPaths: Record<string, string> }
```

## Common Pitfalls
- Always use full model filenames as `value` in MODEL_DEFINITIONS (e.g. `htdemucs_ft.yaml` not `htdemucs_ft`)
- New nodes must not send `id` to the API — use the `new:` prefix trick and strip it at save time
- `sourceNodeId` in new nodes should reference an already-persisted parent; if not, set to `null` and save in two steps
