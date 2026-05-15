# Task Completion Checklist

After completing a coding task in this project:

1. **Build**: `dotnet build` — ensure no compilation errors
2. **Run**: `dotnet run` from `FluentAudioSplit.Api/` and verify the endpoint works (check `/swagger` for new endpoints)
3. **EF Migrations**: If you changed any `DbContext` or entity, add and apply a migration:
   ```bash
   dotnet ef migrations add <MigrationName> \
     --project FluentAudioSplit.Infrastructure/FluentAudioSplit.Infrastructure.csproj \
     --startup-project FluentAudioSplit.Api/FluentAudioSplit.Api.csproj \
     --context ApplicationDbContext \
     --output-dir Persistence/Migrations
   ```
4. **No automated tests** are configured yet — rely on manual API testing via Swagger or HTTP client
5. **Check nullability warnings** — nullable reference types are enabled; address any new warnings
