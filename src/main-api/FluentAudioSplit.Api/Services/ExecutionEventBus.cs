using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;

namespace FluentAudioSplit.Api.Services;

public class ExecutionEventBus
{
    // Anonymous event payloads (NodeCompleted, ExecutionFailed, ...) already spell their property
    // names in camelCase by hand, so the default (PascalCase) naming policy never mattered for
    // those. But a raw DTO record like WorkflowExecutionDto (used by the Snapshot event) has
    // PascalCase properties — serializing it with the default policy would produce
    // `NodeExecutions` etc., silently mismatching every other camelCase field the frontend
    // expects (`workflowVersionId`, `nodeExecutions`, ...) from the plain `apiClient` JSON
    // responses (ASP.NET Core's MVC pipeline applies `JsonSerializerDefaults.Web` — camelCase —
    // automatically; raw `JsonSerializer.Serialize` calls outside that pipeline do not). Reuse the
    // same Web defaults here so every SSE payload matches the REST API's casing.
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly ConcurrentDictionary<Guid, List<ChannelWriter<string>>> _subscribers = new();
    private readonly ILogger<ExecutionEventBus> _logger;

    public ExecutionEventBus(ILogger<ExecutionEventBus> logger)
    {
        _logger = logger;
    }

    public async Task PublishAsync(Guid executionId, object eventPayload)
    {
        var json = JsonSerializer.Serialize(eventPayload, JsonOptions);
        if (!_subscribers.TryGetValue(executionId, out var writers))
            return;

        List<ChannelWriter<string>> snapshot;
        lock (writers)
            snapshot = writers.ToList();

        foreach (var writer in snapshot)
        {
            try { await writer.WriteAsync(json); }
            catch (Exception ex) { _logger.LogWarning(ex, "Failed to write SSE event to subscriber for execution {Id}", executionId); }
        }
    }

    /// <summary>
    /// Registers a subscriber synchronously (before any snapshot/backfill read), so an event
    /// published between "read current state from the DB" and "start reading from the stream"
    /// is never lost. Dispose the returned subscription to unregister.
    /// </summary>
    public ExecutionSubscription Subscribe(Guid executionId)
    {
        var channel = Channel.CreateUnbounded<string>();
        var writers = _subscribers.GetOrAdd(executionId, _ => new List<ChannelWriter<string>>());
        lock (writers) writers.Add(channel.Writer);
        return new ExecutionSubscription(this, executionId, channel);
    }

    private void Unsubscribe(Guid executionId, ChannelWriter<string> writer)
    {
        writer.TryComplete();
        if (_subscribers.TryGetValue(executionId, out var list))
        {
            lock (list)
            {
                list.Remove(writer);
                if (list.Count == 0)
                    _subscribers.TryRemove(executionId, out _);
            }
        }
    }

    public sealed class ExecutionSubscription : IDisposable
    {
        private readonly ExecutionEventBus _bus;
        private readonly Guid _executionId;
        private readonly Channel<string> _channel;

        internal ExecutionSubscription(ExecutionEventBus bus, Guid executionId, Channel<string> channel)
        {
            _bus = bus;
            _executionId = executionId;
            _channel = channel;
        }

        public ChannelReader<string> Reader => _channel.Reader;

        public void Dispose() => _bus.Unsubscribe(_executionId, _channel.Writer);
    }
}
