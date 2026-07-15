using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FluentAudioSplit.Api.Dtos;
using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
using FluentAudioSplit.Infrastructure.Persistence;
using MassTransit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Controllers;

[ApiController]
[Route("api/executions")]
[Authorize]
public class ExecutionsController : ControllerBase
{
    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly ISendEndpointProvider _sendEndpoint;
    private readonly ExecutionEventBus _eventBus;
    private readonly ILogger<ExecutionsController> _logger;

    public ExecutionsController(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        ISendEndpointProvider sendEndpoint,
        ExecutionEventBus eventBus,
        ILogger<ExecutionsController> logger)
    {
        _dbFactory = dbFactory;
        _sendEndpoint = sendEndpoint;
        _eventBus = eventBus;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<List<WorkflowExecutionDto>>> List(CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var executions = await db.WorkflowExecutions
            .Include(we => we.WorkflowVersion)
                .ThenInclude(v => v.Workflow)
            .Include(we => we.InputFileRecord)
            .Include(we => we.NodeExecutions)
            .Where(we => we.UserId == userId)
            .OrderByDescending(we => we.CreatedAt)
            .ToListAsync(ct);

        return Ok(executions.Select(ToDto).ToList());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<WorkflowExecutionDto>> GetById(Guid id, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var execution = await db.WorkflowExecutions
            .Include(we => we.WorkflowVersion)
                .ThenInclude(v => v.Workflow)
            .Include(we => we.InputFileRecord)
            .Include(we => we.NodeExecutions)
            .FirstOrDefaultAsync(we => we.Id == id && we.UserId == userId, ct);

        if (execution is null) return NotFound();
        return Ok(ToDto(execution));
    }

    [HttpGet("{id:guid}/stream")]
    public async Task StreamExecution(Guid id, CancellationToken ct)
    {
        Response.Headers["Content-Type"] = "text/event-stream; charset=utf-8";
        Response.Headers["Cache-Control"] = "no-cache, no-store";
        Response.Headers["X-Accel-Buffering"] = "no";
        Response.Headers["Connection"] = "keep-alive";

        await foreach (var json in _eventBus.StreamAsync(id, ct))
        {
            var line = $"data: {json}\n\n";
            await Response.WriteAsync(line, Encoding.UTF8, ct);
            await Response.Body.FlushAsync(ct);
        }
    }

    [HttpPost("{id:guid}/nodes/{nodeExecId:guid}/retry")]
    public async Task<ActionResult<NodeExecutionDto>> RetryNode(
        Guid id, Guid nodeExecId, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var execution = await db.WorkflowExecutions
            .Include(we => we.WorkflowVersion)
            .FirstOrDefaultAsync(we => we.Id == id && we.UserId == userId, ct);
        if (execution is null) return NotFound("Execution not found.");

        var failedNode = await db.NodeExecutions
            .FirstOrDefaultAsync(ne => ne.Id == nodeExecId && ne.WorkflowExecutionId == id, ct);
        if (failedNode is null) return NotFound("Node execution not found.");
        if (failedNode.Status != NodeExecutionStatus.Failed)
            return BadRequest("Node execution is not in Failed state.");

        var nodeDefs = DeserializeNodes(execution.WorkflowVersion.StructureJson);
        var nodeDef = nodeDefs.FirstOrDefault(n => n.Id == failedNode.WorkflowNodeId);

        var newNodeExec = new NodeExecution
        {
            WorkflowExecutionId = id,
            WorkflowNodeId = failedNode.WorkflowNodeId,
            Attempt = failedNode.Attempt + 1,
            Status = NodeExecutionStatus.Queued,
            InputArtifactPath = failedNode.InputArtifactPath,
            OutputArtifactDir = $"executions/{id}/nodes/{Guid.NewGuid()}/"
        };

        db.NodeExecutions.Add(newNodeExec);
        execution.Status = WorkflowExecutionStatus.Running;
        await db.SaveChangesAsync(ct);

        var endpoint = await _sendEndpoint.GetSendEndpoint(new Uri("queue:process-node"));
        await endpoint.Send(new ProcessNodeCommand
        {
            WorkflowExecutionId = id,
            NodeExecutionId = newNodeExec.Id,
            NodeType = nodeDef?.NodeType ?? string.Empty,
            InputArtifactPath = newNodeExec.InputArtifactPath ?? string.Empty,
            OutputArtifactDir = newNodeExec.OutputArtifactDir ?? string.Empty,
            ConfigJson = nodeDef?.ConfigJson ?? "{}"
        }, ct);

        return Ok(NodeExecToDto(newNodeExec, nodeDef));
    }

    [HttpPost("{id:guid}/cancel")]
    public async Task<ActionResult<WorkflowExecutionDto>> Cancel(Guid id, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var execution = await db.WorkflowExecutions
            .Include(we => we.WorkflowVersion)
                .ThenInclude(v => v.Workflow)
            .Include(we => we.InputFileRecord)
            .Include(we => we.NodeExecutions)
            .FirstOrDefaultAsync(we => we.Id == id && we.UserId == userId, ct);

        if (execution is null) return NotFound("Execution not found.");
        if (ExecutionReconciler.IsTerminal(execution.Status))
            return BadRequest("Execution has already finished.");

        var now = DateTime.UtcNow;

        // Mark not-yet-finished nodes as Cancelled. A node already handed to the worker may still
        // finish (there's no worker-side cancellation channel); NodeCompletedConsumer guards
        // against resurrecting a cancelled execution or spawning its downstream nodes.
        foreach (var ne in execution.NodeExecutions)
        {
            if (ne.Status is NodeExecutionStatus.Pending
                or NodeExecutionStatus.Queued
                or NodeExecutionStatus.Running)
            {
                ne.Status = NodeExecutionStatus.Cancelled;
                ne.CompletedAt = now;
            }
        }

        execution.Status = WorkflowExecutionStatus.Cancelled;
        execution.CompletedAt = now;
        await db.SaveChangesAsync(ct);

        await _eventBus.PublishAsync(id, new
        {
            type = "ExecutionCancelled",
            workflowExecutionId = id
        });

        return Ok(ToDto(execution));
    }

    [HttpGet("{id:guid}/results")]
    public async Task<ActionResult<List<string>>> GetResults(Guid id, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var execution = await db.WorkflowExecutions
            .Include(we => we.NodeExecutions)
            .FirstOrDefaultAsync(we => we.Id == id && we.UserId == userId, ct);

        if (execution is null) return NotFound();

        var paths = execution.NodeExecutions
            .Where(ne => ne.Status == NodeExecutionStatus.Completed && ne.OutputArtifactPathsJson != null)
            .SelectMany(ne =>
                JsonSerializer.Deserialize<Dictionary<string, string>>(ne.OutputArtifactPathsJson!)?.Values ?? Enumerable.Empty<string>())
            .ToList();

        return Ok(paths);
    }

    private static List<WorkflowNodeDefinition> DeserializeNodes(string json) =>
        JsonSerializer.Deserialize<List<WorkflowNodeDefinition>>(json) ?? new();

    private static string? ExtractModelName(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return null;
        try
        {
            using var doc = JsonDocument.Parse(configJson);
            return doc.RootElement.TryGetProperty("modelName", out var m) ? m.GetString() : null;
        }
        catch { return null; }
    }

    private static WorkflowExecutionDto ToDto(WorkflowExecution we)
    {
        // Build a lookup from the version this execution was pinned to, so orphaned node
        // executions (whose ids no longer exist in the latest version) still render a real label.
        var defsById = new Dictionary<Guid, WorkflowNodeDefinition>();
        if (we.WorkflowVersion?.StructureJson is { } json)
        {
            foreach (var def in DeserializeNodes(json))
                defsById[def.Id] = def;
        }

        return new(
            we.Id,
            we.WorkflowId,
            we.WorkflowVersionId,
            we.WorkflowVersion?.Workflow?.Name ?? string.Empty,
            we.InputFileRecord is not null
                ? new FileRecordDto(we.InputFileRecord.Id, we.InputFileRecord.OriginalFileName, we.InputFileRecord.ContentType, we.InputFileRecord.SizeBytes, we.InputFileRecord.CreatedAt)
                : new FileRecordDto(we.InputFileRecordId, string.Empty, string.Empty, 0, DateTime.MinValue),
            we.Status.ToString(),
            we.NodeExecutions?.Select(ne => NodeExecToDto(ne, defsById.GetValueOrDefault(ne.WorkflowNodeId))).ToList() ?? new(),
            we.CreatedAt,
            we.CompletedAt,
            we.ErrorMessage);
    }

    private static NodeExecutionDto NodeExecToDto(NodeExecution ne, WorkflowNodeDefinition? def = null) => new(
        ne.Id,
        ne.WorkflowNodeId,
        ne.Attempt,
        ne.Status.ToString(),
        ne.OutputArtifactDir,
        ne.OutputArtifactPathsJson != null
            ? JsonSerializer.Deserialize<Dictionary<string, string>>(ne.OutputArtifactPathsJson) ?? new()
            : new(),
        ne.ErrorMessage,
        ne.StartedAt,
        ne.CompletedAt,
        def != null ? $"Node {def.Order + 1}" : null,
        ExtractModelName(def?.ConfigJson));
}
