namespace FluentAudioSplit.Api.Messages;

public record NodeCompletedEvent
{
    public Guid WorkflowExecutionId { get; init; }
    public Guid NodeExecutionId { get; init; }
    public Dictionary<string, string> OutputArtifactPaths { get; init; } = new();
}
