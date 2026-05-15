# Suggested Commands

All commands run from `/home/karemsfar/Repos/fluent-audio-split/src/main-api` unless noted.

## Run the API
```bash
cd FluentAudioSplit.Api
dotnet run
# API: https://localhost:5001 (or http://localhost:5000)
# Swagger: https://localhost:5001/swagger
```

## Build
```bash
dotnet build
```

## EF Core Migrations
```bash
export PATH="$PATH:$HOME/.dotnet/tools"   # ensure dotnet-ef is on PATH

# Add a new migration
dotnet ef migrations add <MigrationName> \
  --project FluentAudioSplit.Infrastructure/FluentAudioSplit.Infrastructure.csproj \
  --startup-project FluentAudioSplit.Api/FluentAudioSplit.Api.csproj \
  --context ApplicationDbContext \
  --output-dir Persistence/Migrations

# Apply migrations
dotnet ef database update \
  --project FluentAudioSplit.Infrastructure/FluentAudioSplit.Infrastructure.csproj \
  --startup-project FluentAudioSplit.Api/FluentAudioSplit.Api.csproj
```

## Docker (from repo root)
```bash
docker compose up --build
```

## Tests (none yet configured)
No test project exists yet.
