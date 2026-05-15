# Suggested Commands

All commands run from `/home/karemsfar/Repos/fluent-audio-split/src/front` unless noted.

## Development
```bash
npm run dev
# Starts Vite dev server (usually http://localhost:5173)
```

## Build
```bash
npm run build
# Runs tsc -b && vite build → outputs to dist/
```

## Lint
```bash
npm run lint
# Runs ESLint
```

## Storybook
```bash
npm run storybook
# Starts Storybook on port 6006
```

## Docker (from repo root)
```bash
docker compose up --build front
# Builds and serves via nginx on port 3000
```

## Adding shadcn/ui components
```bash
npx shadcn@latest add <component-name>
# e.g. npx shadcn@latest add dialog
```

## Tests
No test framework is configured yet.
