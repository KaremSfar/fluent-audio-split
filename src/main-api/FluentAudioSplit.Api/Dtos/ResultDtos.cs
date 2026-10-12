namespace FluentAudioSplit.Api.Dtos;

public record ResultTrackDto(
    Guid Id,
    Guid WorkflowNodeId,
    string OutputName,
    string DisplayName,
    string Origin,      // Kept | Default | Manual
    int SortOrder,
    string State,       // Ready | Pending | Failed | Cancelled | Missing
    string? ArtifactPath,
    string? ErrorMessage,
    string NodeLabel,
    string NodeType,
    string? ModelName);

public record AvailableStemDto(Guid WorkflowNodeId, string OutputName, string DisplayName, string NodeLabel, string ArtifactPath);

public record ExecutionResultsDto(
    Guid ExecutionId,
    Guid WorkflowId,
    string WorkflowName,
    string Status,
    FileRecordDto InputFile,
    double? TrimStartSeconds,
    double? TrimEndSeconds,
    string KeepMode,    // Explicit | Default
    List<ResultTrackDto> Tracks,
    List<AvailableStemDto> Available);

public record AddResultTrackRequest(Guid WorkflowNodeId, string OutputName);
