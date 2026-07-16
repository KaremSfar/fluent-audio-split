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

        // Idempotency: NodeCompletedEvent can be redelivered (at-least-once delivery). If this
        // node was already completed, re-running the chaining logic below would spawn duplicate
        // downstream executions and duplicate (GPU-expensive) work, so skip the duplicate.
        if (nodeExec.Status == NodeExecutionStatus.Completed)
        {
            _logger.LogInformation("NodeExecution {Id} already completed; skipping duplicate event", msg.NodeExecutionId);
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

        // If the user cancelled the execution while this node was mid-flight, record the node's
        // output but do NOT spawn downstream work or resurrect a terminal execution.
        if (workflowExec.Status == WorkflowExecutionStatus.Cancelled)
        {
            _logger.LogInformation(
                "WorkflowExecution {Id} is cancelled; not chaining downstream nodes", msg.WorkflowExecutionId);
            await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
            {
                type = "NodeCompleted",
                nodeExecutionId = msg.NodeExecutionId,
                workflowNodeId = nodeExec.WorkflowNodeId,
                attempt = nodeExec.Attempt,
                outputArtifactPaths = msg.OutputArtifactPaths
            });
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
            // If this downstream node expects a specific parent stem that the parent didn't
            // actually produce (e.g. a model-registry naming mismatch dropped that stem), do
            // NOT silently substitute a different stem's path — that would run the node on the
            // wrong audio with no visible error. Fail it explicitly instead.
            string? resolvedPath = null;
            var stemMissing = downstream.SourceOutputName != null
                && !msg.OutputArtifactPaths.TryGetValue(downstream.SourceOutputName, out resolvedPath);

            if (stemMissing)
            {
                var producedStems = string.Join(", ", msg.OutputArtifactPaths.Keys);
                var errorMessage =
                    $"Required stem '{downstream.SourceOutputName}' was not produced by the " +
                    $"parent node (produced: {(producedStems.Length > 0 ? producedStems : "none")}).";

                var failedNodeExec = new NodeExecution
                {
                    WorkflowExecutionId = msg.WorkflowExecutionId,
                    WorkflowNodeId = downstream.Id,
                    Status = NodeExecutionStatus.Failed,
                    ErrorMessage = errorMessage,
                    OutputArtifactDir = $"executions/{msg.WorkflowExecutionId}/nodes/{Guid.NewGuid()}/",
                    CompletedAt = DateTime.UtcNow
                };

                db.NodeExecutions.Add(failedNodeExec);
                await db.SaveChangesAsync(ct);

                await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
                {
                    type = "NodeFailed",
                    nodeExecutionId = failedNodeExec.Id,
                    workflowNodeId = failedNodeExec.WorkflowNodeId,
                    attempt = failedNodeExec.Attempt,
                    errorMessage,
                    isTransient = false
                });

                _logger.LogWarning(
                    "Downstream node {NodeId} not dispatched: {ErrorMessage}",
                    downstream.Id, errorMessage);

                continue;
            }

            var inputPath = downstream.SourceOutputName != null
                ? resolvedPath!
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

        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "NodeCompleted",
            nodeExecutionId = msg.NodeExecutionId,
            workflowNodeId = nodeExec.WorkflowNodeId,
            attempt = nodeExec.Attempt,
            outputArtifactPaths = msg.OutputArtifactPaths
        });

        // Settle the execution only once nothing is still in flight. Any downstream nodes queued
        // just above keep it Running; when the final leaf completes the reconciler returns the
        // terminal status so we emit exactly one terminal event.
        var terminal = await ExecutionReconciler.ReconcileAsync(db, msg.WorkflowExecutionId, ct);

        if (terminal is not null)
        {
            await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
            {
                type = ExecutionReconciler.ToEventType(terminal.Value),
                workflowExecutionId = msg.WorkflowExecutionId
            });
        }
    }
}
