namespace FluentAudioSplit.Api.Messages;

public record ProcessNodeCommand
{
    public Guid WorkflowExecutionId { get; init; }
    public Guid NodeExecutionId { get; init; }
    public string NodeType { get; init; } = string.Empty;
    public string InputArtifactPath { get; init; } = string.Empty;
    public string OutputArtifactDir { get; init; } = string.Empty;
    public string ConfigJson { get; init; } = "{}";
}
