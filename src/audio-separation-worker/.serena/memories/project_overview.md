# Project Overview: fluent-audio-split frontend

## Purpose
React SPA frontend for **Fluent Audio Split** — an audio stem-splitter app with a visual workflow/DAG editor.
Users log in, create audio-splitting pipelines, submit them, and view results. Communicates with the C# API backend (`src/main-api`) via REST + JWT auth.

## Tech Stack
| Concern | Choice |
|---|---|
| Framework | React 19 with TypeScript 6.x |
| Build Tool | Vite 8.x |
| Routing | react-router-dom v7 |
| State/Data | @tanstack/react-query v5, React Context (auth) |
| HTTP Client | Axios (with JWT interceptor) |
| Forms | react-hook-form + zod validation + @hookform/resolvers |
| UI Components | shadcn/ui (Radix primitives + Tailwind CSS 3) |
| Icons | lucide-react, @radix-ui/react-icons |
| Styling | Tailwind CSS 3, class-variance-authority, tailwind-merge, clsx |
| Observability | OpenTelemetry (web SDK, fetch instrumentation) |
| Storybook | Storybook 10 for component dev |

## Directory Structure
```
src/front/src/
├── App.tsx                  ← Main routing component (BrowserRouter + Routes)
├── main.tsx                 ← Entry point
├── auth/
│   ├── AuthContext.tsx       ← AuthProvider context (login, register, logout, token hydration)
│   ├── authService.ts       ← API calls (login, register, logout)
│   └── useAuth.ts           ← useContext(AuthContext) hook
├── components/ui/           ← shadcn/ui components (Button, Card, Form, Input, etc.)
├── lib/                     ← Utility functions (cn helper for tailwind-merge)
├── pages/
│   ├── LoginPage.tsx         ← Login form with zod validation
│   ├── RegisterPage.tsx      ← Registration form
│   ├── DashboardPage.tsx     ← Protected dashboard (auth guard via useEffect)
│   └── DummyPage.tsx         ← Test page: sends HelloWorldCommand to API
├── services/
│   └── apiClient.ts          ← Axios instance (base URL from VITE_SERVICE_URL, auto-attaches JWT)
├── telemetry/                ← OpenTelemetry setup
├── stories/                  ← Storybook stories
└── types/
    └── auth.ts               ← TypeScript interfaces (LoginRequest, RegisterRequest, AuthResponse, User)
```

## Routes
| Path | Component | Auth Required |
|---|---|---|
| `/login` | LoginPage | No |
| `/register` | RegisterPage | No |
| `/dashboard` | DashboardPage | Yes (redirect to /login) |
| `/dummy` | DummyPage | Yes (redirect to /login) |
| `/` | Redirects to `/dashboard` | — |

## Auth Flow
1. Login form → `POST /api/auth/login` → receives JWT `accessToken`
2. Token stored in `localStorage['auth_token']`, email in `localStorage['auth_email']`
3. Axios interceptor auto-attaches `Authorization: Bearer <token>` on all requests
4. On app mount, AuthContext hydrates from localStorage
5. Protected pages check `isAuthenticated` via `useAuth()` hook, redirect to `/login` if false

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `VITE_SERVICE_URL` | `http://localhost:5001` | API base URL (Docker overrides to `http://localhost:8080`) |
| `VITE_OTEL_ENDPOINT` | `http://localhost:4318` | OpenTelemetry collector endpoint |

## Docker
- Built via multi-stage: Node build → nginx serving static files
- Port `3000` externally
- `VITE_SERVICE_URL` set via Docker Compose build arg
