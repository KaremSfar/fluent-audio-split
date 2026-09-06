using System.Text.Json;
using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
using FluentAudioSplit.Infrastructure.Persistence;
using MassTransit;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Consumers;

public class NodeFailedConsumer : IConsumer<NodeFailedEvent>
{
    // Bounded auto-retry for transient node failures (e.g. a cold-start Modal volume race that
    // succeeds on a plain retry with no changes) — self-heals without the user having to notice
    // a red node and click Retry. Caps at a few attempts so a persistently-failing (non-transient)
    // node still surfaces to the user instead of retrying forever.
    private const int MaxAutoRetryAttempts = 3;

    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly ISendEndpointProvider _sendEndpoint;
    private readonly ExecutionEventBus _eventBus;
    private readonly ILogger<NodeFailedConsumer> _logger;

    public NodeFailedConsumer(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        ISendEndpointProvider sendEndpoint,
        ExecutionEventBus eventBus,
        ILogger<NodeFailedConsumer> logger)
    {
        _dbFactory = dbFactory;
        _sendEndpoint = sendEndpoint;
        _eventBus = eventBus;
        _logger = logger;
    }

    public async Task Consume(ConsumeContext<NodeFailedEvent> context)
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

        nodeExec.Status = NodeExecutionStatus.Failed;
        nodeExec.ErrorMessage = msg.ErrorMessage;
        nodeExec.CompletedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);

        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "NodeFailed",
            nodeExecutionId = msg.NodeExecutionId,
            workflowNodeId = nodeExec.WorkflowNodeId,
            attempt = nodeExec.Attempt,
            errorMessage = msg.ErrorMessage,
            isTransient = msg.IsTransient
        });

        if (msg.IsTransient && nodeExec.Attempt < MaxAutoRetryAttempts
            && await TryAutoRetryAsync(db, msg, nodeExec, ct))
        {
            return;
        }

        // Don't mark the whole execution PartiallyFailed on the first node failure — sibling
        // branches may still be running. Reconcile only settles a terminal status once nothing
        // is in flight, and returns non-null exactly on the transition so we emit one terminal
        // event (ExecutionPartiallyFailed / ExecutionFailed).
        var terminal = await ExecutionReconciler.ReconcileAsync(
            db, msg.WorkflowExecutionId, ct);

        if (terminal is not null)
        {
            await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
            {
                type = ExecutionReconciler.ToEventType(terminal.Value),
                workflowExecutionId = msg.WorkflowExecutionId
            });
        }
    }

    /// <summary>
    /// Requeues the failed node as a new attempt (same shape as the manual retry endpoint:
    /// new Guid, same WorkflowNodeId, Attempt+1) after a short backoff. Returns false — leaving
    /// the caller to fall through to normal terminal reconciliation — if the execution was
    /// cancelled or can no longer be found.
    /// </summary>
    private async Task<bool> TryAutoRetryAsync(
        ApplicationDbContext db, NodeFailedEvent msg, NodeExecution failedNode, CancellationToken ct)
    {
        var workflowExec = await db.WorkflowExecutions
            .Include(we => we.WorkflowVersion)
            .FirstOrDefaultAsync(we => we.Id == msg.WorkflowExecutionId, ct);

        if (workflowExec is null || workflowExec.Status == WorkflowExecutionStatus.Cancelled)
            return false;

        var nodeDefs = JsonSerializer.Deserialize<List<WorkflowNodeDefinition>>(
            workflowExec.WorkflowVersion.StructureJson) ?? new();
        var nodeDef = nodeDefs.FirstOrDefault(n => n.Id == failedNode.WorkflowNodeId);

        // Cold-start/contention blips (the motivating case) typically clear within a couple of
        // seconds; back off a little longer on each successive attempt.
        var backoff = TimeSpan.FromSeconds(Math.Pow(2, failedNode.Attempt - 1));
        await Task.Delay(backoff, ct);

        var newNodeExec = new NodeExecution
        {
            WorkflowExecutionId = msg.WorkflowExecutionId,
            WorkflowNodeId = failedNode.WorkflowNodeId,
            Attempt = failedNode.Attempt + 1,
            Status = NodeExecutionStatus.Queued,
            InputArtifactPath = failedNode.InputArtifactPath,
            OutputArtifactDir = $"executions/{msg.WorkflowExecutionId}/nodes/{Guid.NewGuid()}/"
        };

        db.NodeExecutions.Add(newNodeExec);
        workflowExec.Status = WorkflowExecutionStatus.Running;
        await db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "Auto-retrying transient failure for workflow node {NodeId} (execution {ExecId}), attempt {Attempt}",
            failedNode.WorkflowNodeId, msg.WorkflowExecutionId, newNodeExec.Attempt);

        var endpoint = await _sendEndpoint.GetSendEndpoint(new Uri("queue:process-node"));
        await endpoint.Send(new ProcessNodeCommand
        {
            WorkflowExecutionId = msg.WorkflowExecutionId,
            NodeExecutionId = newNodeExec.Id,
            NodeType = nodeDef?.NodeType ?? string.Empty,
            InputArtifactPath = newNodeExec.InputArtifactPath ?? string.Empty,
            OutputArtifactDir = newNodeExec.OutputArtifactDir ?? string.Empty,
            ConfigJson = nodeDef?.ConfigJson ?? "{}",
            TrimStartSeconds = nodeDef?.SourceNodeId == null ? workflowExec.TrimStartSeconds : null,
            TrimEndSeconds = nodeDef?.SourceNodeId == null ? workflowExec.TrimEndSeconds : null
        }, ct);

        return true;
    }
}
