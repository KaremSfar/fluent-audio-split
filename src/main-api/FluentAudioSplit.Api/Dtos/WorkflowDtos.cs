namespace FluentAudioSplit.Api.Dtos;

public record FileRecordDto(Guid Id, string OriginalFileName, string ContentType, long SizeBytes, DateTime CreatedAt, string? ContentHash);
public record ImportYouTubeAudioRequest(string Url);
public record NodeInputDto(Guid SourceNodeId, string SourceOutputName);
public record WorkflowNodeDto(Guid Id, int Order, string NodeType, string ConfigJson, List<NodeInputDto> Inputs, List<string> KeptOutputs);
// VersionId lets the client detect drift between the workflow it's editing/rendering and the
// version a given WorkflowExecution was pinned to (WorkflowExecutionDto.WorkflowVersionId).
public record WorkflowDto(Guid Id, string Name, Guid VersionId, List<WorkflowNodeDto> Nodes, DateTime CreatedAt, DateTime UpdatedAt);
public record CreateWorkflowRequest(string Name, List<CreateWorkflowNodeRequest> Nodes);
public record CreateWorkflowNodeRequest(Guid? Id, int Order, string NodeType, string ConfigJson, List<NodeInputDto> Inputs, List<string> KeptOutputs);
public record UpdateWorkflowRequest(string Name, List<UpdateWorkflowNodeRequest> Nodes);
public record UpdateWorkflowNodeRequest(Guid? Id, int Order, string NodeType, string ConfigJson, List<NodeInputDto> Inputs, List<string> KeptOutputs);
