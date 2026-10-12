namespace FluentAudioSplit.Domain.Entities;

public enum ResultTrackOrigin { Kept, Default, Manual }

/// <summary>
/// A stem that is part of an execution's results. The artifact path is NOT stored: it is resolved
/// at query time from the latest completed attempt of <see cref="WorkflowNodeId"/>, so retries are
/// reflected automatically.
/// </summary>
public class ResultTrack
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkflowExecutionId { get; set; }
    public WorkflowExecution WorkflowExecution { get; set; } = null!;
    public Guid WorkflowNodeId { get; set; }
    public string OutputName { get; set; } = string.Empty;
    public ResultTrackOrigin Origin { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
