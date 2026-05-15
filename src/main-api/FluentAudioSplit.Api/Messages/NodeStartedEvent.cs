namespace FluentAudioSplit.Api.Messages;

public record NodeStartedEvent
{
    public Guid WorkflowExecutionId { get; init; }
    public Guid NodeExecutionId { get; init; }
}
