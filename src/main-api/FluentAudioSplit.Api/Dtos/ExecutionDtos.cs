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
    DateTime? CompletedAt);

public record WorkflowExecutionDto(
    Guid Id,
    Guid WorkflowId,
    string WorkflowName,
    FileRecordDto InputFile,
    string Status,
    List<NodeExecutionDto> NodeExecutions,
    DateTime CreatedAt,
    DateTime? CompletedAt,
    string? ErrorMessage);

public record StartExecutionRequest(Guid FileId);
