# Task Completion Checklist

When completing a task on this monorepo:

1. **Build check**: `docker compose build` (or language-specific build for the sub-project)
2. **If API changed**: Run EF Core migrations if schema was modified
3. **If model registry changed**: Update all 3 locations (Python, C#, TypeScript)
   - `src/front/src/lib/models.ts` — TypeScript `MODEL_DEFINITIONS` array (150+ models as of May 2026)
   - `src/audio-separation-worker/app/models.py` — Python stems mapping
   - `src/main-api/FluentAudioSplit.Domain/Models/StemDefinitions.cs` — C# stems
   - ⚠️ As of May 2026: TypeScript has 150+ models; Python and C# are NOT yet updated to match
4. **Verify docker compose**: Ensure `docker compose up --build` still works if docker-related files changed
5. **No global test suite** at monorepo level — test within each sub-project as needed
