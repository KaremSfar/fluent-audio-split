# Task Completion Checklist

After completing a coding task in this project:

1. **Lint**: `npm run lint` — fix any ESLint errors
2. **Build**: `npm run build` — ensure TypeScript compiles and Vite builds successfully
3. **Manual smoke test**: `npm run dev` and verify the relevant pages/components render correctly in the browser
4. If new UI components were added via shadcn/ui, verify they appear correctly in Storybook: `npm run storybook`
5. No automated test suite is configured — rely on TypeScript + ESLint + manual testing
