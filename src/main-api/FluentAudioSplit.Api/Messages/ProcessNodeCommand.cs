namespace FluentAudioSplit.Api.Messages;

public record NodeInputArtifact
{
    public string Path { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public double GainDb { get; init; }
}

public record ProcessNodeCommand
{
    public Guid WorkflowExecutionId { get; init; }
    public Guid NodeExecutionId { get; init; }
    public string NodeType { get; init; } = string.Empty;
    // AudioSeparation only ("" for Merge).
    public string InputArtifactPath { get; init; } = string.Empty;
    // Merge only, ordered as the node definition's inputs (empty for AudioSeparation).
    public List<NodeInputArtifact> InputArtifacts { get; init; } = new();
    public string OutputArtifactDir { get; init; } = string.Empty;
    public string ConfigJson { get; init; } = "{}";
    public double? TrimStartSeconds { get; init; }
    public double? TrimEndSeconds { get; init; }
}
