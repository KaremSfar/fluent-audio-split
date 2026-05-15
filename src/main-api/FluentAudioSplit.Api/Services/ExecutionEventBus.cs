using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;

namespace FluentAudioSplit.Api.Services;

public class ExecutionEventBus
{
    private readonly ConcurrentDictionary<Guid, List<ChannelWriter<string>>> _subscribers = new();
    private readonly ILogger<ExecutionEventBus> _logger;

    public ExecutionEventBus(ILogger<ExecutionEventBus> logger)
    {
        _logger = logger;
    }

    public async Task PublishAsync(Guid executionId, object eventPayload)
    {
        var json = JsonSerializer.Serialize(eventPayload);
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

    public async IAsyncEnumerable<string> StreamAsync(Guid executionId, [EnumeratorCancellation] CancellationToken ct = default)
    {
        var channel = Channel.CreateUnbounded<string>();
        var writers = _subscribers.GetOrAdd(executionId, _ => new List<ChannelWriter<string>>());
        lock (writers) writers.Add(channel.Writer);

        try
        {
            await foreach (var item in channel.Reader.ReadAllAsync(ct))
                yield return item;
        }
        finally
        {
            lock (writers) writers.Remove(channel.Writer);
            channel.Writer.TryComplete();
            if (_subscribers.TryGetValue(executionId, out var list))
            {
                lock (list)
                {
                    if (list.Count == 0)
                        _subscribers.TryRemove(executionId, out _);
                }
            }
        }
    }
}
