# Task Completion Checklist

After completing a coding task in this project:

1. **Build**: `npm run build` — ensure TypeScript compiles and Vite bundles without errors
2. **Lint**: `npm run lint` — check for ESLint issues
3. **Manual test**: Run `npm run dev` and verify changes in the browser
4. **No automated tests** are configured yet — rely on manual testing
5. **Check types**: TypeScript strict mode is enabled; address any type errors
6. **Routing**: If adding a new page, register the route in `App.tsx`
7. **Auth**: If the page requires auth, add the `useAuth()` guard pattern (see DashboardPage)
