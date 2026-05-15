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
| Storybook | **Storybook 8** — stories in `src/stories/` |

## Folder Structure

```
src/
  auth/           # AuthContext, authService, useAuth hook
  components/
    ui/           # shadcn/ui components (button, input, label, card, form)
    nodes/        # (reserved for future flow/node components)
  hooks/          # Custom React hooks
  lib/            # Utilities (utils.ts with cn())
  pages/          # Route-level page components
  services/       # API clients (apiClient.ts)
  stories/        # Storybook stories
  telemetry/      # OpenTelemetry setup
  types/          # TypeScript type definitions
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_SERVICE_URL` | `http://localhost:5001` | Backend API base URL |
| `VITE_OTEL_ENDPOINT` | `http://localhost:4318` | OpenTelemetry collector endpoint |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run storybook` | Start Storybook on port 6006 |
| `npm run build-storybook` | Build Storybook static site |
