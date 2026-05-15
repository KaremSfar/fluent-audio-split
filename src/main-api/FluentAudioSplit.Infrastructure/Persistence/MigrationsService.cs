using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

namespace FluentAudioSplit.Infrastructure.Persistence;

public class MigrationsService<T> : IHostedService
    where T : DbContext
{
    private readonly IDbContextFactory<T> _dbContextFactory;

    public MigrationsService(IDbContextFactory<T> dbContextFactory)
    {
        _dbContextFactory = dbContextFactory;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);
        await dbContext.Database.MigrateAsync(cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
