using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Infrastructure.Persistence;
using MassTransit;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Consumers;

public class NodeStartedConsumer : IConsumer<NodeStartedEvent>
{
    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly ExecutionEventBus _eventBus;
    private readonly ILogger<NodeStartedConsumer> _logger;

    public NodeStartedConsumer(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        ExecutionEventBus eventBus,
        ILogger<NodeStartedConsumer> logger)
    {
        _dbFactory = dbFactory;
        _eventBus = eventBus;
        _logger = logger;
    }

    public async Task Consume(ConsumeContext<NodeStartedEvent> context)
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

        nodeExec.Status = NodeExecutionStatus.Running;
        nodeExec.StartedAt = DateTime.UtcNow;

        var workflowExec = await db.WorkflowExecutions
            .FirstOrDefaultAsync(we => we.Id == msg.WorkflowExecutionId, context.CancellationToken);

        if (workflowExec is not null && workflowExec.Status == WorkflowExecutionStatus.Pending)
        {
            workflowExec.Status = WorkflowExecutionStatus.Running;
        }

        await db.SaveChangesAsync(context.CancellationToken);

        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "NodeStarted",
            nodeExecutionId = msg.NodeExecutionId,
            status = "Running"
        });

        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "ExecutionRunning",
            workflowExecutionId = msg.WorkflowExecutionId,
            status = "Running"
        });
    }
}
