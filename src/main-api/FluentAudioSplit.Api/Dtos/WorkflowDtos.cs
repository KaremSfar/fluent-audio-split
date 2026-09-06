namespace FluentAudioSplit.Api.Dtos;

public record FileRecordDto(Guid Id, string OriginalFileName, string ContentType, long SizeBytes, DateTime CreatedAt, string? ContentHash);
public record ImportYouTubeAudioRequest(string Url);
public record WorkflowNodeDto(Guid Id, int Order, string NodeType, string ConfigJson, Guid? SourceNodeId, string? SourceOutputName);
// VersionId lets the client detect drift between the workflow it's editing/rendering and the
// version a given WorkflowExecution was pinned to (WorkflowExecutionDto.WorkflowVersionId).
public record WorkflowDto(Guid Id, string Name, Guid VersionId, List<WorkflowNodeDto> Nodes, DateTime CreatedAt, DateTime UpdatedAt);
public record CreateWorkflowRequest(string Name, List<CreateWorkflowNodeRequest> Nodes);
public record CreateWorkflowNodeRequest(int Order, string NodeType, string ConfigJson, Guid? SourceNodeId, string? SourceOutputName);
public record UpdateWorkflowRequest(string Name, List<UpdateWorkflowNodeRequest> Nodes);
public record UpdateWorkflowNodeRequest(Guid? Id, int Order, string NodeType, string ConfigJson, Guid? SourceNodeId, string? SourceOutputName);
