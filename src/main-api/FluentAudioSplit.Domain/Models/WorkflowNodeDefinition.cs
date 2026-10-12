using System.Text.Json.Serialization;

namespace FluentAudioSplit.Domain.Models;

/// <summary>One input edge of a node: which upstream node output feeds it.</summary>
public record NodeInputDefinition(Guid SourceNodeId, string SourceOutputName);

/// <summary>
/// Plain data object representing a node within a workflow version's JSON structure.
/// Not an EF entity — serialized (camelCase, see <see cref="WorkflowJson"/>) into
/// WorkflowVersion.StructureJson.
/// </summary>
public record WorkflowNodeDefinition
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public int Order { get; init; }
    public string NodeType { get; init; } = NodeTypes.AudioSeparation;
    public string ConfigJson { get; init; } = "{}";
    public List<NodeInputDefinition> Inputs { get; init; } = new();
    public List<string> KeptOutputs { get; init; } = new();

    [JsonIgnore]
    public bool IsRoot => Inputs.Count == 0;
}
