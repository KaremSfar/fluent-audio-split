# Code Style and Conventions

## Naming
- Public members: `PascalCase`
- Private fields: `_camelCase`
- Standard C# conventions throughout

## Types & Nullability
- Nullable reference types **enabled** (`<Nullable>enable</Nullable>`)
- Use `IOptions<T>` (Options pattern) for typed config sections

## Architecture Rules
- **Thin controllers** — business logic belongs in services/domain layer
- Register dependencies via `IServiceCollection` extension methods per layer (e.g. `AddInfrastructure()`, `AddAuth()`)
- All controllers use `[Route("api/[controller]")]`
- **Startup class pattern**: `Program.cs` delegates to `Startup.ConfigureServices` + `Startup.Configure`. Do NOT collapse to minimal API style.

## Async
- **Async/await everywhere.** No blocking calls: no `Task.Result`, `.Wait()`, or `.GetAwaiter().GetResult()`

## Auth
- Always use ASP.NET Identity (`UserManager`, `SignInManager`) — do NOT roll custom password hashing

## Validation
- Use `FluentValidation` or Data Annotations for request validation

## File Paths
- Always use **relative paths** in DB records and MassTransit messages — never absolute paths

## Key Constraints
1. No Python in this project — API orchestrates via queue only
2. JWT expiry: 1-hour access tokens
3. SQLite locally, Docker volume `/data` in container
