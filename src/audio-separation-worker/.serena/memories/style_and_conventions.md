# Code Style and Conventions

## Language & Types
- **TypeScript** with strict mode
- Use proper type annotations on all function signatures and component props
- Auth types defined in `src/types/auth.ts`

## Component Patterns
- **Functional components** only (React 19)
- Use `export default function ComponentName()` pattern
- Use **react-hook-form** + **zod** for form validation (see LoginPage, RegisterPage)
- Use **@tanstack/react-query** `useMutation` for API mutations (see AuthContext)
- Use **useAuth()** hook for auth context — never use `useContext(AuthContext)` directly

## UI Components
- **shadcn/ui** components from `@/components/ui/` — Button, Card, Form, Input, etc.
- Composable: use `CardHeader`, `CardContent`, `CardFooter` etc.
- Styling via **Tailwind CSS 3** utility classes
- Use `cn()` from `@/lib/utils` for conditional class merging (clsx + tailwind-merge)

## API Calls
- Use `apiClient` from `@/services/apiClient` (Axios instance with JWT interceptor)
- Never construct axios instances directly
- API base path is `/api` (appended to VITE_SERVICE_URL)

## Auth Guards
- Protected pages use `useEffect` + `useAuth()` to redirect to `/login` if not authenticated
- Pattern: check `isLoading` and `isAuthenticated`, navigate if needed

## File Organization
- Pages in `src/pages/`
- Auth logic in `src/auth/`
- Shared UI in `src/components/ui/`
- API service layer in `src/services/`
- Type definitions in `src/types/`

## Imports
- Use `@/` path alias (maps to `src/`)
- Example: `import { Button } from '@/components/ui/button'`
