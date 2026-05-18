# Style and Conventions (Monorepo)

## General
- Each sub-project follows its own language conventions (see per-project memories)
- Docker Compose is the canonical way to run the full stack
- Environment variables configure inter-service communication

## Cross-Project Sync Points
1. **Model registry** — must be identical across all 3 sub-projects
2. **MassTransit message contracts** — C# API publishes/consumes; Python worker uses JSON envelope format
3. **File paths** — always relative to shared volume mount; never absolute

## Git
- Branch naming: `users/<username>/<feature>`
- Commit messages: imperative mood, concise
