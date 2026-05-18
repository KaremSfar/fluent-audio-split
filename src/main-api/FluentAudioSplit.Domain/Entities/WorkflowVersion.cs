namespace FluentAudioSplit.Domain.Entities;

public class WorkflowVersion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkflowId { get; set; }
    public Workflow Workflow { get; set; } = null!;
    public int VersionNumber { get; set; }
    public string StructureJson { get; set; } = "[]";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
