namespace FluentAudioSplit.Api.Messages;

public record NodeFailedEvent
{
    public Guid WorkflowExecutionId { get; init; }
    public Guid NodeExecutionId { get; init; }
    public string ErrorMessage { get; init; } = string.Empty;
    public bool IsTransient { get; init; }
}
