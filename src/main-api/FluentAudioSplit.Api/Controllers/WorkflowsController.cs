using System.Security.Claims;
using FluentAudioSplit.Api.Dtos;
using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Infrastructure.Persistence;
using MassTransit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class WorkflowsController : ControllerBase
{
    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly ISendEndpointProvider _sendEndpoint;
    private readonly ILogger<WorkflowsController> _logger;

    public WorkflowsController(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        ISendEndpointProvider sendEndpoint,
        ILogger<WorkflowsController> logger)
    {
        _dbFactory = dbFactory;
        _sendEndpoint = sendEndpoint;
        _logger = logger;
    }

    [HttpPost]
    public async Task<ActionResult<WorkflowDto>> Create([FromBody] CreateWorkflowRequest request, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var workflow = new Workflow
        {
            Name = request.Name,
            UserId = userId,
            Nodes = request.Nodes.Select(n => new WorkflowNode
            {
                Order = n.Order,
                NodeType = n.NodeType,
                ConfigJson = n.ConfigJson
            }).ToList()
        };

        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        db.Workflows.Add(workflow);
        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetById), new { id = workflow.Id }, ToDto(workflow));
    }

    [HttpGet]
    public async Task<ActionResult<List<WorkflowDto>>> List(CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var workflows = await db.Workflows
            .Include(w => w.Nodes)
            .Where(w => w.UserId == userId)
            .OrderByDescending(w => w.CreatedAt)
            .ToListAsync(ct);

        return Ok(workflows.Select(ToDto).ToList());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<WorkflowDto>> GetById(Guid id, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var workflow = await db.Workflows
            .Include(w => w.Nodes)
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId, ct);

        if (workflow is null) return NotFound();
        return Ok(ToDto(workflow));
    }

    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<WorkflowDto>> Update(Guid id, [FromBody] UpdateWorkflowRequest request, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var workflow = await db.Workflows
            .Include(w => w.Nodes)
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId, ct);

        if (workflow is null) return NotFound();

        workflow.Name = request.Name;
        workflow.UpdatedAt = DateTime.UtcNow;

        // Remove nodes no longer in the request
        var incomingIds = request.Nodes.Where(n => n.Id.HasValue).Select(n => n.Id!.Value).ToHashSet();
        var toRemove = workflow.Nodes.Where(n => !incomingIds.Contains(n.Id)).ToList();
        db.WorkflowNodes.RemoveRange(toRemove);

        foreach (var nodeReq in request.Nodes)
        {
            if (nodeReq.Id.HasValue)
            {
                var existing = workflow.Nodes.FirstOrDefault(n => n.Id == nodeReq.Id.Value);
                if (existing is not null)
                {
                    existing.Order = nodeReq.Order;
                    existing.NodeType = nodeReq.NodeType;
                    existing.ConfigJson = nodeReq.ConfigJson;
                }
            }
            else
            {
                workflow.Nodes.Add(new WorkflowNode
                {
                    WorkflowId = workflow.Id,
                    Order = nodeReq.Order,
                    NodeType = nodeReq.NodeType,
                    ConfigJson = nodeReq.ConfigJson,
                });
            }
        }

        await db.SaveChangesAsync(ct);
        return Ok(ToDto(workflow));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var workflow = await db.Workflows.FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId, ct);
        if (workflow is null) return NotFound();

        db.Workflows.Remove(workflow);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>POST api/workflows/{id}/execute — starts a WorkflowExecution</summary>
    [HttpPost("{id:guid}/execute")]
    public async Task<ActionResult<WorkflowExecutionDto>> Execute(
        Guid id,
        [FromBody] StartExecutionRequest request,
        CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var workflow = await db.Workflows
            .Include(w => w.Nodes.OrderBy(n => n.Order))
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId, ct);

        if (workflow is null) return NotFound("Workflow not found.");

        var fileRecord = await db.FileRecords
            .FirstOrDefaultAsync(f => f.Id == request.FileId && f.UserId == userId, ct);

        if (fileRecord is null) return NotFound("File not found.");

        var execution = new WorkflowExecution
        {
            WorkflowId = workflow.Id,
            UserId = userId,
            InputFileRecordId = fileRecord.Id,
            Status = WorkflowExecutionStatus.Pending
        };

        db.WorkflowExecutions.Add(execution);

        var firstNode = workflow.Nodes.OrderBy(n => n.Order).First();
        var nodeExec = new NodeExecution
        {
            WorkflowExecutionId = execution.Id,
            WorkflowNodeId = firstNode.Id,
            Status = NodeExecutionStatus.Queued,
            InputArtifactPath = fileRecord.StoragePath,
            OutputArtifactDir = $"executions/{execution.Id}/nodes/{Guid.NewGuid()}/"
        };

        db.NodeExecutions.Add(nodeExec);
        await db.SaveChangesAsync(ct);

        var endpoint = await _sendEndpoint.GetSendEndpoint(new Uri("queue:process-node"));
        await endpoint.Send(new ProcessNodeCommand
        {
            WorkflowExecutionId = execution.Id,
            NodeExecutionId = nodeExec.Id,
            NodeType = firstNode.NodeType,
            InputArtifactPath = nodeExec.InputArtifactPath,
            OutputArtifactDir = nodeExec.OutputArtifactDir,
            ConfigJson = firstNode.ConfigJson
        }, ct);

        execution.Status = WorkflowExecutionStatus.Running;
        await db.SaveChangesAsync(ct);

        _logger.LogInformation("Started execution {ExecutionId} for workflow {WorkflowId}", execution.Id, workflow.Id);

        var nodeExecs = new List<NodeExecution> { nodeExec };
        return Ok(new WorkflowExecutionDto(
            execution.Id,
            execution.WorkflowId,
            workflow.Name,
            new FileRecordDto(fileRecord.Id, fileRecord.OriginalFileName, fileRecord.ContentType, fileRecord.SizeBytes, fileRecord.CreatedAt),
            execution.Status.ToString(),
            nodeExecs.Select(ne => new NodeExecutionDto(ne.Id, ne.WorkflowNodeId, ne.Attempt, ne.Status.ToString(), ne.OutputArtifactDir, ne.OutputArtifactPathsJson != null ? System.Text.Json.JsonSerializer.Deserialize<List<string>>(ne.OutputArtifactPathsJson) ?? new() : new(), ne.ErrorMessage, ne.StartedAt, ne.CompletedAt)).ToList(),
            execution.CreatedAt,
            execution.CompletedAt,
            execution.ErrorMessage));
    }

    private static WorkflowDto ToDto(Workflow w) => new(
        w.Id,
        w.Name,
        w.Nodes.OrderBy(n => n.Order).Select(n => new WorkflowNodeDto(n.Id, n.Order, n.NodeType, n.ConfigJson)).ToList(),
        w.CreatedAt,
        w.UpdatedAt);
}
