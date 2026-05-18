namespace FluentAudioSplit.Domain.Models;

/// <summary>
/// Plain data object representing a node within a workflow version's JSON structure.
/// Not an EF entity — serialized into WorkflowVersion.StructureJson.
/// </summary>
public record WorkflowNodeDefinition
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public int Order { get; init; }
    public string NodeType { get; init; } = string.Empty;
    public string ConfigJson { get; init; } = "{}";
    public Guid? SourceNodeId { get; init; }
    public string? SourceOutputName { get; init; }
}
