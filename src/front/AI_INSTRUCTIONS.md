# Fluent Audio Split — Frontend AI Instructions

## Manual Setup Required

The following setup steps must be run manually by a developer after cloning:

1. Copy `.env.example` to `.env.development` and fill in values.
2. **shadcn/ui** was configured manually (not via interactive CLI). `components.json` is committed.
   To add new shadcn components: `npx shadcn@latest add <component-name>`
3. **Storybook** was initialized manually. Run `npm run storybook` to start it.

## Tech Stack

| Tool | Details |
|---|---|
| Framework | **React 19** + **TypeScript** via Vite |
| Styling | **Tailwind CSS v3** |
| UI Components | **shadcn/ui** (New York style, Violet theme) — components in `src/components/ui/` |
| Forms | **react-hook-form** + **Zod** for validation |
| HTTP Client | **Axios** via `src/services/apiClient.ts` |
| Routing | **React Router v6** |
| Server State | **TanStack Query (React Query v5)** |
| Telemetry | **OpenTelemetry** — initialized in `src/telemetry/otel.ts` |
| Storybook | **Storybook 10** — stories in `src/stories/`. Addons (`addon-essentials`, `addon-interactions`, `blocks`, `test`) are bundled into the core `storybook` package at v10; do **not** add them as separate dependencies. |

## Folder Structure

```
src/
  auth/           # AuthContext, authService, useAuth hook
  components/
    ui/           # shadcn/ui components (button, input, label, card, form, badge, progress, table, separator, tabs)
    nodes/        # (reserved for future flow/node components)
  hooks/          # Custom React hooks (useExecutionStream)
  lib/            # Utilities (utils.ts with cn())
  pages/          # Route-level page components
  services/       # API clients (apiClient.ts, filesService.ts, workflowsService.ts, executionsService.ts)
  stories/        # Storybook stories
  telemetry/      # OpenTelemetry setup
  types/          # TypeScript type definitions (auth.ts, file.ts, workflow.ts, execution.ts)
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_SERVICE_URL` | `http://localhost:8080` | Backend API base URL |
| `VITE_OTEL_ENDPOINT` | `http://localhost:4318` | OpenTelemetry collector endpoint |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run storybook` | Start Storybook on port 6006 |
| `npm run build-storybook` | Build Storybook static site |

## Pages & Routes

| Route | Component | Description |
|---|---|---|
| `/dashboard` | `DashboardPage` | Home with navigation cards |
| `/files` | `FilesPage` | Upload & manage audio files |
| `/workflows/new` | `WorkflowBuilderPage` | Create workflow + start execution |
| `/executions` | `ExecutionsListPage` | Execution history table |
| `/executions/:id` | `ExecutionPage` | Live execution monitor with SSE |

## Key Hooks

- `useExecutionStream({ executionId, onNodeStatus, onExecutionStatus, enabled })` — subscribes to SSE stream via `@microsoft/fetch-event-source`. Auto-aborts when `enabled=false` or component unmounts.

## API Services

All services use `apiClient` (base: `VITE_SERVICE_URL/api`). URLs in services do **not** include `/api` prefix.

- `filesService` — upload, list, delete, getDownloadUrl
- `workflowsService` — create, list, get, delete
- `executionsService` — start, list, get, retry, getResults

## Auth Pattern

JWT stored in `localStorage` under key `auth_token`. `apiClient` injects it as `Authorization: Bearer …`.
