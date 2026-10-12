using FluentAudioSplit.Api.Consumers;
using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
using FluentAudioSplit.Infrastructure.Persistence;
using MassTransit;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FluentAudioSplit.Tests;

/// <summary>Captures every message sent through the provider (thread-safe).</summary>
public sealed class FakeSendEndpointProvider : ISendEndpointProvider
{
    private readonly FakeEndpoint _endpoint = new();
    public IReadOnlyList<ProcessNodeCommand> Commands => _endpoint.Sent.ToArray();

    public Task<ISendEndpoint> GetSendEndpoint(Uri address) => Task.FromResult<ISendEndpoint>(_endpoint);
    public ConnectHandle ConnectSendObserver(ISendObserver observer) => throw new NotSupportedException();

    private sealed class FakeEndpoint : ISendEndpoint
    {
        public readonly System.Collections.Concurrent.ConcurrentQueue<ProcessNodeCommand> Sent = new();

        public Task Send<T>(T message, CancellationToken cancellationToken = default) where T : class
        {
            if (message is ProcessNodeCommand c) Sent.Enqueue(c);
            return Task.CompletedTask;
        }
        public Task Send<T>(T message, IPipe<SendContext<T>> pipe, CancellationToken cancellationToken = default) where T : class => Send(message, cancellationToken);
        public Task Send<T>(T message, IPipe<SendContext> pipe, CancellationToken cancellationToken = default) where T : class => Send(message, cancellationToken);
        public Task Send(object message, CancellationToken cancellationToken = default) => Send<object>(message, cancellationToken);
        public Task Send(object message, Type messageType, CancellationToken cancellationToken = default) => Send<object>(message, cancellationToken);
        public Task Send(object message, IPipe<SendContext> pipe, CancellationToken cancellationToken = default) => Send<object>(message, cancellationToken);
        public Task Send(object message, Type messageType, IPipe<SendContext> pipe, CancellationToken cancellationToken = default) => Send<object>(message, cancellationToken);
        public Task Send<T>(object values, CancellationToken cancellationToken = default) where T : class => Task.CompletedTask;
        public Task Send<T>(object values, IPipe<SendContext<T>> pipe, CancellationToken cancellationToken = default) where T : class => Task.CompletedTask;
        public Task Send<T>(object values, IPipe<SendContext> pipe, CancellationToken cancellationToken = default) where T : class => Task.CompletedTask;
        public ConnectHandle ConnectSendObserver(ISendObserver observer) => throw new NotSupportedException();
    }
}

/// <summary>
/// A real (file-backed) SQLite database with the app's migrations applied, so multiple
/// DbContexts can be used concurrently like in production. Also verifies the migration matches the model.
/// </summary>
public sealed class TestDb : IDbContextFactory<ApplicationDbContext>, IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"fas-test-{Guid.NewGuid():N}.db");
    private readonly DbContextOptions<ApplicationDbContext> _options;

    public TestDb()
    {
        _options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite($"Data Source={_path};Pooling=False")
            .Options;
        using var db = CreateDbContext();
        db.Database.Migrate();
    }

    public ApplicationDbContext CreateDbContext() => new(_options);

    public void Dispose()
    {
        foreach (var f in new[] { _path, _path + "-wal", _path + "-shm", _path + "-journal" })
            try { File.Delete(f); } catch { /* best effort */ }
    }
}

public static class Nodes
{
    public static WorkflowNodeDefinition Split(int order, Guid? id = null, params (Guid src, string output)[] inputs) => new()
    {
        Id = id ?? Guid.NewGuid(),
        Order = order,
        NodeType = NodeTypes.AudioSeparation,
        ConfigJson = "{\"modelName\":\"m.ckpt\"}",
        Inputs = inputs.Select(i => new NodeInputDefinition(i.src, i.output)).ToList(),
    };

    public static WorkflowNodeDefinition Merge(int order, string? config, params (Guid src, string output)[] inputs) => new()
    {
        Id = Guid.NewGuid(),
        Order = order,
        NodeType = NodeTypes.Merge,
        ConfigJson = config ?? "{}",
        Inputs = inputs.Select(i => new NodeInputDefinition(i.src, i.output)).ToList(),
    };
}

/// <summary>Seeds an execution and exposes the services/consumer under test.</summary>
public sealed class Harness : IDisposable
{
    public TestDb Db { get; } = new();
    public FakeSendEndpointProvider Sender { get; } = new();
    public ExecutionEventBus Bus { get; } = new(NullLogger<ExecutionEventBus>.Instance);
    public ResultTrackService Results { get; } = new();
    public Guid ExecutionId { get; private set; }
    public IReadOnlyList<WorkflowNodeDefinition> Defs { get; private set; } = Array.Empty<WorkflowNodeDefinition>();

    public NodeDispatcher NewDispatcher() => new(Sender, NullLogger<NodeDispatcher>.Instance);

    public NodeCompletedConsumer NewCompletedConsumer() =>
        new(Db, NewDispatcher(), Results, Bus, NullLogger<NodeCompletedConsumer>.Instance);

    public async Task SeedAsync(IReadOnlyList<WorkflowNodeDefinition> defs)
    {
        Defs = defs;
        await using var db = Db.CreateDbContext();
        var user = new ApplicationUser { UserName = "u@test", Email = "u@test" };
        db.Users.Add(user);
        var file = new FileRecord
        {
            Id = Guid.NewGuid(), UserId = user.Id, OriginalFileName = "song.mp3", StoragePath = "uploads/u/song.mp3",
            ContentType = "audio/mpeg", SizeBytes = 1,
        };
        db.FileRecords.Add(file);
        var wf = new Workflow { Name = "wf", UserId = user.Id };
        var ver = new WorkflowVersion { WorkflowId = wf.Id, VersionNumber = 1, StructureJson = WorkflowJson.Serialize(defs) };
        wf.Versions.Add(ver);
        db.Workflows.Add(wf);
        var exec = new WorkflowExecution
        {
            WorkflowId = wf.Id, WorkflowVersionId = ver.Id, UserId = user.Id,
            InputFileRecordId = file.Id, Status = WorkflowExecutionStatus.Running,
        };
        db.WorkflowExecutions.Add(exec);
        await db.SaveChangesAsync();
        ExecutionId = exec.Id;
    }

    public string UserId() { using var db = Db.CreateDbContext(); return db.Users.Select(u => u.Id).First(); }

    /// <summary>Inserts a Running attempt for a node (as the dispatcher would have).</summary>
    public async Task<NodeExecution> AddRunningAsync(WorkflowNodeDefinition def, int attempt = 1)
    {
        await using var db = Db.CreateDbContext();
        var ne = new NodeExecution
        {
            WorkflowExecutionId = ExecutionId, WorkflowNodeId = def.Id, NodeType = def.NodeType,
            Attempt = attempt, Status = NodeExecutionStatus.Running,
            OutputArtifactDir = $"executions/{ExecutionId}/nodes/{Guid.NewGuid()}/",
        };
        db.NodeExecutions.Add(ne);
        await db.SaveChangesAsync();
        return ne;
    }

    public Task CompleteAsync(NodeExecution ne, params string[] outputs) =>
        NewCompletedConsumer().HandleAsync(new NodeCompletedEvent
        {
            WorkflowExecutionId = ExecutionId,
            NodeExecutionId = ne.Id,
            OutputArtifactPaths = outputs.ToDictionary(o => o, o => $"{ne.OutputArtifactDir}{o.ToLowerInvariant()}_{ne.Id.ToString()[..5]}.mp3"),
        }, CancellationToken.None);

    public void Dispose() => Db.Dispose();
}
