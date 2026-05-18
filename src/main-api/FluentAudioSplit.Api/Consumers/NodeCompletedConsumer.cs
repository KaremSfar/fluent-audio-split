using System.Text.Json;
using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
using FluentAudioSplit.Infrastructure.Persistence;
using MassTransit;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Consumers;

public class NodeCompletedConsumer : IConsumer<NodeCompletedEvent>
{
    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly ISendEndpointProvider _sendEndpoint;
    private readonly ExecutionEventBus _eventBus;
    private readonly ILogger<NodeCompletedConsumer> _logger;

    public NodeCompletedConsumer(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        ISendEndpointProvider sendEndpoint,
        ExecutionEventBus eventBus,
        ILogger<NodeCompletedConsumer> logger)
    {
        _dbFactory = dbFactory;
        _sendEndpoint = sendEndpoint;
        _eventBus = eventBus;
        _logger = logger;
    }

    public async Task Consume(ConsumeContext<NodeCompletedEvent> context)
    {
        var msg = context.Message;
        var ct = context.CancellationToken;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var nodeExec = await db.NodeExecutions
            .FirstOrDefaultAsync(ne => ne.Id == msg.NodeExecutionId, ct);

        if (nodeExec is null)
        {
            _logger.LogWarning("NodeExecution {Id} not found", msg.NodeExecutionId);
            return;
        }

        nodeExec.Status = NodeExecutionStatus.Completed;
        nodeExec.OutputArtifactPathsJson = JsonSerializer.Serialize(msg.OutputArtifactPaths);
        nodeExec.OutputArtifactDir = msg.OutputArtifactPaths.Count > 0
            ? Path.GetDirectoryName(msg.OutputArtifactPaths.Values.First()) ?? nodeExec.OutputArtifactDir
            : nodeExec.OutputArtifactDir;
        nodeExec.CompletedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);

        // Load the workflow version to get the node graph
        var workflowExec = await db.WorkflowExecutions
            .Include(we => we.WorkflowVersion)
            .Include(we => we.NodeExecutions)
            .FirstOrDefaultAsync(we => we.Id == msg.WorkflowExecutionId, ct);

        if (workflowExec is null)
        {
            _logger.LogWarning("WorkflowExecution {Id} not found", msg.WorkflowExecutionId);
            return;
        }

        var nodeDefs = JsonSerializer.Deserialize<List<WorkflowNodeDefinition>>(
            workflowExec.WorkflowVersion.StructureJson) ?? new();

        // Chain downstream nodes
        var completedWorkflowNodeId = nodeExec.WorkflowNodeId;
        var downstreamNodes = nodeDefs
            .Where(n => n.SourceNodeId == completedWorkflowNodeId)
            .ToList();

        var endpoint = await _sendEndpoint.GetSendEndpoint(new Uri("queue:process-node"));

        foreach (var downstream in downstreamNodes)
        {
            var inputPath = downstream.SourceOutputName != null
                && msg.OutputArtifactPaths.TryGetValue(downstream.SourceOutputName, out var resolvedPath)
                ? resolvedPath
                : msg.OutputArtifactPaths.Values.FirstOrDefault() ?? string.Empty;

            var newNodeExec = new NodeExecution
            {
                WorkflowExecutionId = msg.WorkflowExecutionId,
                WorkflowNodeId = downstream.Id,
                Status = NodeExecutionStatus.Queued,
                InputArtifactPath = inputPath,
                OutputArtifactDir = $"executions/{msg.WorkflowExecutionId}/nodes/{Guid.NewGuid()}/"
            };

            db.NodeExecutions.Add(newNodeExec);
            await db.SaveChangesAsync(ct);

            await endpoint.Send(new ProcessNodeCommand
            {
                WorkflowExecutionId = msg.WorkflowExecutionId,
                NodeExecutionId = newNodeExec.Id,
                NodeType = downstream.NodeType,
                InputArtifactPath = newNodeExec.InputArtifactPath ?? string.Empty,
                OutputArtifactDir = newNodeExec.OutputArtifactDir ?? string.Empty,
                ConfigJson = downstream.ConfigJson
            }, ct);
        }

        // Check if ALL workflow nodes have completed executions
        // Reload to get freshly added node executions
        await db.Entry(workflowExec).Collection(we => we.NodeExecutions).LoadAsync(ct);

        var allNodeIds = nodeDefs.Select(n => n.Id).ToHashSet();
        var completedNodeIds = workflowExec.NodeExecutions
            .Where(ne => ne.Status == NodeExecutionStatus.Completed)
            .Select(ne => ne.WorkflowNodeId)
            .ToHashSet();

        var allCompleted = allNodeIds.All(id => completedNodeIds.Contains(id));

        if (allCompleted)
        {
            workflowExec.Status = WorkflowExecutionStatus.Completed;
            workflowExec.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }

        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "NodeCompleted",
            nodeExecutionId = msg.NodeExecutionId,
            outputArtifactPaths = msg.OutputArtifactPaths
        });

        if (workflowExec.Status == WorkflowExecutionStatus.Completed)
        {
            await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
            {
                type = "ExecutionCompleted",
                workflowExecutionId = msg.WorkflowExecutionId
            });
        }
    }
}
