using System.Security.Claims;
using System.Text.Json;
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
                ConfigJson = n.ConfigJson,
                SourceNodeId = n.SourceNodeId,
                SourceOutputName = n.SourceOutputName
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
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId, ct);

        if (workflow is null) return NotFound();

        // Update workflow header directly (bypasses EF tracking on nodes)
        await db.Workflows
            .Where(w => w.Id == id)
            .ExecuteUpdateAsync(s => s
                .SetProperty(w => w.Name, request.Name)
                .SetProperty(w => w.UpdatedAt, DateTime.UtcNow), ct);

        var incomingIds = request.Nodes
            .Where(n => n.Id.HasValue)
            .Select(n => n.Id!.Value)
            .ToList();

        // Delete nodes no longer in the request (skip nodes that have executions — Restrict FK)
        await db.WorkflowNodes
            .Where(n => n.WorkflowId == id && !incomingIds.Contains(n.Id))
            .ExecuteDeleteAsync(ct);

        // Update existing nodes directly
        foreach (var nodeReq in request.Nodes.Where(n => n.Id.HasValue))
        {
            await db.WorkflowNodes
                .Where(n => n.Id == nodeReq.Id!.Value)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(n => n.Order, nodeReq.Order)
                    .SetProperty(n => n.NodeType, nodeReq.NodeType)
                    .SetProperty(n => n.ConfigJson, nodeReq.ConfigJson)
                    .SetProperty(n => n.SourceNodeId, nodeReq.SourceNodeId)
                    .SetProperty(n => n.SourceOutputName, nodeReq.SourceOutputName), ct);
        }

        // Insert new nodes
        var newNodes = request.Nodes
            .Where(n => !n.Id.HasValue)
            .Select(n => new WorkflowNode
            {
                WorkflowId = id,
                Order = n.Order,
                NodeType = n.NodeType,
                ConfigJson = n.ConfigJson,
                SourceNodeId = n.SourceNodeId,
                SourceOutputName = n.SourceOutputName,
            })
            .ToList();

        if (newNodes.Count > 0)
        {
            db.WorkflowNodes.AddRange(newNodes);
            await db.SaveChangesAsync(ct);
        }

        // Reload the full workflow to return the updated state
        var updated = await db.Workflows
            .Include(w => w.Nodes)
            .FirstAsync(w => w.Id == id, ct);

        return Ok(ToDto(updated));
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

        var rootNodes = workflow.Nodes.Where(n => n.SourceNodeId == null).ToList();
        var nodeExecs = new List<NodeExecution>();

        foreach (var rootNode in rootNodes)
        {
            var nodeExec = new NodeExecution
            {
                WorkflowExecutionId = execution.Id,
                WorkflowNodeId = rootNode.Id,
                Status = NodeExecutionStatus.Queued,
                InputArtifactPath = fileRecord.StoragePath,
                OutputArtifactDir = $"executions/{execution.Id}/nodes/{Guid.NewGuid()}/"
            };
            db.NodeExecutions.Add(nodeExec);
            nodeExecs.Add(nodeExec);
        }

        await db.SaveChangesAsync(ct);

        var endpoint = await _sendEndpoint.GetSendEndpoint(new Uri("queue:process-node"));
        foreach (var nodeExec in nodeExecs)
        {
            var workflowNode = rootNodes.First(n => n.Id == nodeExec.WorkflowNodeId);
            await endpoint.Send(new ProcessNodeCommand
            {
                WorkflowExecutionId = execution.Id,
                NodeExecutionId = nodeExec.Id,
                NodeType = workflowNode.NodeType,
                InputArtifactPath = nodeExec.InputArtifactPath ?? string.Empty,
                OutputArtifactDir = nodeExec.OutputArtifactDir ?? string.Empty,
                ConfigJson = workflowNode.ConfigJson
            }, ct);
        }

        execution.Status = WorkflowExecutionStatus.Running;
        await db.SaveChangesAsync(ct);

        _logger.LogInformation("Started execution {ExecutionId} for workflow {WorkflowId}", execution.Id, workflow.Id);

        return Ok(new WorkflowExecutionDto(
            execution.Id,
            execution.WorkflowId,
            workflow.Name,
            new FileRecordDto(fileRecord.Id, fileRecord.OriginalFileName, fileRecord.ContentType, fileRecord.SizeBytes, fileRecord.CreatedAt),
            execution.Status.ToString(),
            nodeExecs.Select(ne => new NodeExecutionDto(ne.Id, ne.WorkflowNodeId, ne.Attempt, ne.Status.ToString(), ne.OutputArtifactDir, ne.OutputArtifactPathsJson != null ? JsonSerializer.Deserialize<Dictionary<string, string>>(ne.OutputArtifactPathsJson) ?? new() : new(), ne.ErrorMessage, ne.StartedAt, ne.CompletedAt)).ToList(),
            execution.CreatedAt,
            execution.CompletedAt,
            execution.ErrorMessage));
    }

    private static WorkflowDto ToDto(Workflow w) => new(
        w.Id,
        w.Name,
        w.Nodes.OrderBy(n => n.Order).Select(n => new WorkflowNodeDto(n.Id, n.Order, n.NodeType, n.ConfigJson, n.SourceNodeId, n.SourceOutputName)).ToList(),
        w.CreatedAt,
        w.UpdatedAt);
}
