namespace FluentAudioSplit.Api.Dtos;

public record FileRecordDto(Guid Id, string OriginalFileName, string ContentType, long SizeBytes, DateTime CreatedAt);
public record WorkflowNodeDto(Guid Id, int Order, string NodeType, string ConfigJson, Guid? SourceNodeId, string? SourceOutputName);
public record WorkflowDto(Guid Id, string Name, List<WorkflowNodeDto> Nodes, DateTime CreatedAt, DateTime UpdatedAt);
public record CreateWorkflowRequest(string Name, List<CreateWorkflowNodeRequest> Nodes);
public record CreateWorkflowNodeRequest(int Order, string NodeType, string ConfigJson, Guid? SourceNodeId, string? SourceOutputName);
public record UpdateWorkflowRequest(string Name, List<UpdateWorkflowNodeRequest> Nodes);
public record UpdateWorkflowNodeRequest(Guid? Id, int Order, string NodeType, string ConfigJson, Guid? SourceNodeId, string? SourceOutputName);
