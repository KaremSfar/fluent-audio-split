using System.Text.Json;
using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Infrastructure.Persistence;
using MassTransit;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Consumers;

public class NodeCompletedConsumer : IConsumer<NodeCompletedEvent>
{
    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly ExecutionEventBus _eventBus;
    private readonly ILogger<NodeCompletedConsumer> _logger;

    public NodeCompletedConsumer(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        ExecutionEventBus eventBus,
        ILogger<NodeCompletedConsumer> logger)
    {
        _dbFactory = dbFactory;
        _eventBus = eventBus;
        _logger = logger;
    }

    public async Task Consume(ConsumeContext<NodeCompletedEvent> context)
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

        nodeExec.Status = NodeExecutionStatus.Completed;
        nodeExec.OutputArtifactPathsJson = JsonSerializer.Serialize(msg.OutputArtifactPaths);
        nodeExec.OutputArtifactDir = msg.OutputArtifactPaths.Count > 0
            ? Path.GetDirectoryName(msg.OutputArtifactPaths[0]) ?? nodeExec.OutputArtifactDir
            : nodeExec.OutputArtifactDir;
        nodeExec.CompletedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(context.CancellationToken);

        var workflowExec = await db.WorkflowExecutions
            .Include(we => we.NodeExecutions)
            .FirstOrDefaultAsync(we => we.Id == msg.WorkflowExecutionId, context.CancellationToken);

        if (workflowExec is not null)
        {
            var allCompleted = workflowExec.NodeExecutions
                .All(ne => ne.Status == NodeExecutionStatus.Completed);

            if (allCompleted)
            {
                workflowExec.Status = WorkflowExecutionStatus.Completed;
                workflowExec.CompletedAt = DateTime.UtcNow;
                await db.SaveChangesAsync(context.CancellationToken);
            }
        }

        await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
        {
            type = "NodeCompleted",
            nodeExecutionId = msg.NodeExecutionId,
            outputArtifactPaths = msg.OutputArtifactPaths
        });

        if (workflowExec?.Status == WorkflowExecutionStatus.Completed)
        {
            await _eventBus.PublishAsync(msg.WorkflowExecutionId, new
            {
                type = "ExecutionCompleted",
                workflowExecutionId = msg.WorkflowExecutionId
            });
        }
    }
}
