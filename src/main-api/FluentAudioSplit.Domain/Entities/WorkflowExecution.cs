namespace FluentAudioSplit.Domain.Entities;

public class WorkflowExecution
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkflowId { get; set; }
    public Guid WorkflowVersionId { get; set; }
    public WorkflowVersion WorkflowVersion { get; set; } = null!;
    public string UserId { get; set; } = string.Empty;
    public ApplicationUser User { get; set; } = null!;
    public Guid InputFileRecordId { get; set; }
    public FileRecord InputFileRecord { get; set; } = null!;
    public WorkflowExecutionStatus Status { get; set; } = WorkflowExecutionStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public string? ErrorMessage { get; set; }
    public ICollection<NodeExecution> NodeExecutions { get; set; } = new List<NodeExecution>();
}
