namespace FluentAudioSplit.Domain.Entities;

public class NodeExecution
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkflowExecutionId { get; set; }
    public WorkflowExecution WorkflowExecution { get; set; } = null!;
    public Guid WorkflowNodeId { get; set; }
    public int Attempt { get; set; } = 1;
    public NodeExecutionStatus Status { get; set; } = NodeExecutionStatus.Pending;
    public string? InputArtifactPath { get; set; }
    public string? OutputArtifactDir { get; set; }
    public string? OutputArtifactPathsJson { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
