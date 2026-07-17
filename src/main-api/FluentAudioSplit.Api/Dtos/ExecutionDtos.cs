namespace FluentAudioSplit.Api.Dtos;

public record NodeExecutionDto(
    Guid Id,
    Guid WorkflowNodeId,
    int Attempt,
    string Status,
    string? OutputArtifactDir,
    Dictionary<string, string> OutputArtifactPaths,
    string? ErrorMessage,
    DateTime? StartedAt,
    DateTime? CompletedAt,
    // Resolved from the version the execution was pinned to, so the UI shows a stable label even
    // after the workflow is edited (which mints new node ids in a new version).
    string? NodeLabel,
    string? ModelName);

public record WorkflowExecutionDto(
    Guid Id,
    Guid WorkflowId,
    Guid WorkflowVersionId,
    string WorkflowName,
    FileRecordDto InputFile,
    string Status,
    List<NodeExecutionDto> NodeExecutions,
    DateTime CreatedAt,
    DateTime? CompletedAt,
    string? ErrorMessage,
    double? TrimStartSeconds,
    double? TrimEndSeconds);

public record StartExecutionRequest(Guid FileId, double? TrimStartSeconds = null, double? TrimEndSeconds = null);
