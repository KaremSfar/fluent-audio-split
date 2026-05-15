# Project Overview: fluent-audio-split Frontend

## Purpose
Frontend for **Fluent Audio Split** — a web app that likely handles audio file splitting/processing. The frontend provides authentication (login/register) and a dashboard UI.

## Tech Stack
- **Framework**: React 19 + TypeScript via Vite
- **Styling**: Tailwind CSS v3
- **UI Components**: shadcn/ui (New York style, Violet theme) — in `src/components/ui/`
- **Forms**: react-hook-form + Zod
- **HTTP Client**: Axios via `src/services/apiClient.ts`
- **Routing**: React Router v7
- **Server State**: TanStack Query (React Query v5)
- **Telemetry**: OpenTelemetry — `src/telemetry/otel.ts`
- **Storybook**: Storybook 10 — stories in `src/stories/`

## Folder Structure
```
src/
  auth/           # AuthContext, authService, useAuth hook
  components/
    ui/           # shadcn/ui components (button, input, label, card, form)
    nodes/        # reserved for future flow/node components
  hooks/          # Custom React hooks
  lib/            # Utilities (utils.ts with cn())
  pages/          # Route-level page components
  services/       # API clients (apiClient.ts)
  stories/        # Storybook stories
  telemetry/      # OpenTelemetry setup
  types/          # TypeScript type definitions
```

## Routes
- `/login` → LoginPage
- `/register` → RegisterPage
- `/dashboard` → DashboardPage
- `/` → redirects to `/dashboard`

## Environment Variables
- `VITE_SERVICE_URL` — Backend API base URL (default: `http://localhost:8080`)
- `VITE_OTEL_ENDPOINT` — OpenTelemetry collector endpoint (default: `http://localhost:4318`)
- Copy `.env.example` to `.env.development` and fill in values before running.
