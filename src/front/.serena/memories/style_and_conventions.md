# Code Style and Conventions

## Language & Types
- TypeScript (strict mode via tsconfig)
- All components use `.tsx`, utilities use `.ts`
- Use Zod schemas for form/API validation

## Naming
- React components: PascalCase (e.g., `LoginPage`, `AuthProvider`)
- Hooks: camelCase prefixed with `use` (e.g., `useAuth`)
- Files: match exported symbol name (e.g., `LoginPage.tsx`)
- Path alias `@/` maps to `src/`

## Styling
- Tailwind CSS utility classes
- shadcn/ui components for UI primitives (New York style, Violet theme)
- `cn()` utility from `src/lib/utils.ts` for conditional class merging

## Forms
- react-hook-form + Zod resolver
- Use shadcn/ui `Form`, `FormField`, `FormItem` components

## State Management
- TanStack Query for server state
- React Context for auth state (`src/auth/AuthContext.tsx`)

## HTTP
- Axios instance from `src/services/apiClient.ts`

## Storybook
- Stories live in `src/stories/`
- Do NOT add storybook addons as separate npm packages (they are bundled in `storybook` v10 core)

## No separate test framework configured (as of onboarding)
