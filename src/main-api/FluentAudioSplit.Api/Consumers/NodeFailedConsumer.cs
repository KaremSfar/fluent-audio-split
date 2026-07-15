using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Infrastructure.Persistence;
using MassTransit;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Consumers;

public class NodeFailedConsumer : IConsumer<NodeFailedEvent>
{
    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly ExecutionEventBus _eventBus;
    private readonly ILogger<NodeFailedConsumer> _logger;

    public NodeFailedConsumer(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        ExecutionEventBus eventBus,
        ILogger<NodeFailedConsumer> logger)
    {
        _dbFactory = dbFactory;
        _eventBus = eventBus;
        _logger = logger;
    }

    public async Task Consume(ConsumeContext<NodeFailedEvent> context)
    {
        var msg = context.Message;
        await using var db = await _dbFactory.CreateDbContextAsync(context.CancellationToken);

        var nodeExec = await db.NodeExecutions
            .FirstOrDefaultAsync(ne => ne.Id == msg.NodeExecutionId, context.CancellationToken);

        if (nodeExec is null)
        {
            _logger.LogWarning("NodeExecution {Id} not found", msg.NodeExecutionId);
            return;
        }

        nodeExec.Status = NodeExecutionStatus.Failed;
        nodeExec.ErrorMessage = msg.ErrorMessage;
        nodeExec.CompletedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(context.CancellationToken);

        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "NodeFailed",
            nodeExecutionId = msg.NodeExecutionId,
            workflowNodeId = nodeExec.WorkflowNodeId,
            attempt = nodeExec.Attempt,
            errorMessage = msg.ErrorMessage,
            isTransient = msg.IsTransient
        });

        // Don't mark the whole execution PartiallyFailed on the first node failure — sibling
        // branches may still be running. Reconcile only settles a terminal status once nothing
        // is in flight, and returns non-null exactly on the transition so we emit one terminal
        // event (ExecutionPartiallyFailed / ExecutionFailed).
        var terminal = await ExecutionReconciler.ReconcileAsync(
            db, msg.WorkflowExecutionId, context.CancellationToken);

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
