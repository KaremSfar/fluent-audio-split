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

        var workflowExec = await db.WorkflowExecutions
            .FirstOrDefaultAsync(we => we.Id == msg.WorkflowExecutionId, context.CancellationToken);

        if (workflowExec is not null)
            workflowExec.Status = WorkflowExecutionStatus.PartiallyFailed;

        await db.SaveChangesAsync(context.CancellationToken);

        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "NodeFailed",
            nodeExecutionId = msg.NodeExecutionId,
            errorMessage = msg.ErrorMessage,
            isTransient = msg.IsTransient
        });

        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "ExecutionPartiallyFailed",
            workflowExecutionId = msg.WorkflowExecutionId
        });
    }
}
