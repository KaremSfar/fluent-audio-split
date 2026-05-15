namespace FluentAudioSplit.Api.Messages;

public record NodeCompletedEvent
{
    public Guid WorkflowExecutionId { get; init; }
    public Guid NodeExecutionId { get; init; }
    public List<string> OutputArtifactPaths { get; init; } = new();
}
