namespace FluentAudioSplit.Domain.Entities;

public class WorkflowNode
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkflowId { get; set; }
    public Workflow Workflow { get; set; } = null!;
    public int Order { get; set; }
    public string NodeType { get; set; } = string.Empty;
    public string ConfigJson { get; set; } = "{}";
    public Guid? SourceNodeId { get; set; }
    public string? SourceOutputName { get; set; }
    public WorkflowNode? SourceNode { get; set; }
}
