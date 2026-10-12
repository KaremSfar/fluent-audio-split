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
    private readonly NodeDispatcher _dispatcher;
    private readonly ResultTrackService _results;
    private readonly ExecutionEventBus _eventBus;
    private readonly ILogger<NodeCompletedConsumer> _logger;

    public NodeCompletedConsumer(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        NodeDispatcher dispatcher,
        ResultTrackService results,
        ExecutionEventBus eventBus,
        ILogger<NodeCompletedConsumer> logger)
    {
        _dbFactory = dbFactory;
        _dispatcher = dispatcher;
        _results = results;
        _eventBus = eventBus;
        _logger = logger;
    }

    public Task Consume(ConsumeContext<NodeCompletedEvent> context) =>
        HandleAsync(context.Message, context.CancellationToken);

    /// <summary>Consumer body, separated from the MassTransit context so it can be unit-tested.</summary>
    public async Task HandleAsync(NodeCompletedEvent msg, CancellationToken ct)
    {
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

        var workflowExec = await db.WorkflowExecutions
            .Include(we => we.WorkflowVersion)
            .FirstOrDefaultAsync(we => we.Id == msg.WorkflowExecutionId, ct);

        if (workflowExec is null)
        {
            _logger.LogWarning("WorkflowExecution {Id} not found", msg.WorkflowExecutionId);
            return;
        }

        var nodeDefs = WorkflowJson.DeserializeNodes(workflowExec.WorkflowVersion.StructureJson);

        // If the user cancelled the execution while this node was mid-flight, record the node's
        // output but do NOT spawn downstream work or resurrect a terminal execution.
        if (workflowExec.Status == WorkflowExecutionStatus.Cancelled)
        {
            _logger.LogInformation(
                "WorkflowExecution {Id} is cancelled; not chaining downstream nodes", msg.WorkflowExecutionId);
            await PublishNodeCompletedAsync(msg, nodeExec);
            return;
        }

        // Default-mode results (before the SSE publish so a client refetching on NodeCompleted
        // already sees the row).
        await _results.OnNodeCompletedAsync(db, workflowExec, nodeDefs, nodeExec, msg.OutputArtifactPaths, ct);

        await PublishNodeCompletedAsync(msg, nodeExec);

        // Chain dependents. A dependent is dispatched only once EVERY one of its inputs is
        // available (Merge join). Two parents of one Merge may complete concurrently on different
        // consumer threads: both can pass the join, and the unique index
        // (execution, node, attempt) makes exactly one insert win — see NodeDispatcher.
        foreach (var dependent in WorkflowGraph.Dependents(nodeDefs, nodeExec.WorkflowNodeId).ToList())
        {
            // Idempotency (redelivery / already chained): any existing row means it was handled.
            var alreadyChained = await db.NodeExecutions.AnyAsync(ne =>
                ne.WorkflowExecutionId == msg.WorkflowExecutionId && ne.WorkflowNodeId == dependent.Id, ct);
            if (alreadyChained)
            {
                _logger.LogInformation(
                    "Skipping duplicate downstream NodeExecution for workflow node {NodeId} (execution {ExecId}); already chained",
                    dependent.Id, msg.WorkflowExecutionId);
                continue;
            }

            var resolved = await _dispatcher.ResolveInputsAsync(db, workflowExec, nodeDefs, dependent, ct);
            switch (resolved.Status)
            {
                case InputResolutionStatus.Waiting:
                    continue;

                case InputResolutionStatus.MissingOutput:
                    var failed = await _dispatcher.FailAsync(db, workflowExec, dependent, resolved.Error ?? "Input was not produced.", ct);
                    if (failed is not null)
                    {
                        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
                        {
                            type = "NodeFailed",
                            nodeExecutionId = failed.Id,
                            workflowNodeId = failed.WorkflowNodeId,
                            attempt = failed.Attempt,
                            nodeType = failed.NodeType,
                            errorMessage = failed.ErrorMessage,
                            isTransient = false
                        });
                    }
                    continue;

                default:
                    await _dispatcher.DispatchAsync(db, workflowExec, nodeDefs, dependent, 1, ct);
                    break;
            }
        }

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

    private Task PublishNodeCompletedAsync(NodeCompletedEvent msg, NodeExecution nodeExec) =>
        _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "NodeCompleted",
            nodeExecutionId = msg.NodeExecutionId,
            workflowNodeId = nodeExec.WorkflowNodeId,
            attempt = nodeExec.Attempt,
            nodeType = nodeExec.NodeType,
            outputArtifactPaths = msg.OutputArtifactPaths
        });
}
