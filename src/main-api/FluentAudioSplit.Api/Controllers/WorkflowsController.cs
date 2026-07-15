using System.Security.Claims;
using System.Text.Json;
using FluentAudioSplit.Api.Dtos;
using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
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

        var nodeDefs = request.Nodes.Select(n => new WorkflowNodeDefinition
        {
            Order = n.Order,
            NodeType = n.NodeType,
            ConfigJson = n.ConfigJson,
            SourceNodeId = n.SourceNodeId,
            SourceOutputName = n.SourceOutputName
        }).ToList();

        var workflow = new Workflow
        {
            Name = request.Name,
            UserId = userId,
        };

        var version = new WorkflowVersion
        {
            WorkflowId = workflow.Id,
            VersionNumber = 1,
            StructureJson = JsonSerializer.Serialize(nodeDefs),
        };

        workflow.Versions.Add(version);

        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        db.Workflows.Add(workflow);
        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetById), new { id = workflow.Id }, ToDto(workflow, version, nodeDefs));
    }

    [HttpGet]
    public async Task<ActionResult<List<WorkflowDto>>> List(CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var workflows = await db.Workflows
            .Include(w => w.Versions)
            .Where(w => w.UserId == userId)
            .OrderByDescending(w => w.CreatedAt)
            .ToListAsync(ct);

        return Ok(workflows.Select(w =>
        {
            var latest = w.Versions.OrderByDescending(v => v.VersionNumber).First();
            var nodes = DeserializeNodes(latest.StructureJson);
            return ToDto(w, latest, nodes);
        }).ToList());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<WorkflowDto>> GetById(Guid id, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var workflow = await db.Workflows
            .Include(w => w.Versions)
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId, ct);

        if (workflow is null) return NotFound();

        var latest = workflow.Versions.OrderByDescending(v => v.VersionNumber).First();
        var nodes = DeserializeNodes(latest.StructureJson);
        return Ok(ToDto(workflow, latest, nodes));
    }

    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<WorkflowDto>> Update(Guid id, [FromBody] UpdateWorkflowRequest request, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var workflow = await db.Workflows
            .Include(w => w.Versions)
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId, ct);

        if (workflow is null) return NotFound();

        workflow.Name = request.Name;
        workflow.UpdatedAt = DateTime.UtcNow;

        var maxVersion = workflow.Versions.Max(v => v.VersionNumber);

        var nodeDefs = request.Nodes.Select(n => new WorkflowNodeDefinition
        {
            Id = n.Id ?? Guid.NewGuid(),
            Order = n.Order,
            NodeType = n.NodeType,
            ConfigJson = n.ConfigJson,
            SourceNodeId = n.SourceNodeId,
            SourceOutputName = n.SourceOutputName
        }).ToList();

        var newVersion = new WorkflowVersion
        {
            WorkflowId = id,
            VersionNumber = maxVersion + 1,
            StructureJson = JsonSerializer.Serialize(nodeDefs),
        };

        db.WorkflowVersions.Add(newVersion);
        await db.SaveChangesAsync(ct);

        return Ok(ToDto(workflow, newVersion, nodeDefs));
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
            .Include(w => w.Versions)
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId, ct);

        if (workflow is null) return NotFound("Workflow not found.");

        var latestVersion = workflow.Versions.OrderByDescending(v => v.VersionNumber).First();
        var nodeDefs = DeserializeNodes(latestVersion.StructureJson);

        var fileRecord = await db.FileRecords
            .FirstOrDefaultAsync(f => f.Id == request.FileId && f.UserId == userId, ct);

        if (fileRecord is null) return NotFound("File not found.");

        var execution = new WorkflowExecution
        {
            WorkflowId = workflow.Id,
            WorkflowVersionId = latestVersion.Id,
            UserId = userId,
            InputFileRecordId = fileRecord.Id,
            Status = WorkflowExecutionStatus.Pending
        };

        db.WorkflowExecutions.Add(execution);

        var rootNodes = nodeDefs.Where(n => n.SourceNodeId == null).ToList();
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
            var nodeDef = rootNodes.First(n => n.Id == nodeExec.WorkflowNodeId);
            await endpoint.Send(new ProcessNodeCommand
            {
                WorkflowExecutionId = execution.Id,
                NodeExecutionId = nodeExec.Id,
                NodeType = nodeDef.NodeType,
                InputArtifactPath = nodeExec.InputArtifactPath ?? string.Empty,
                OutputArtifactDir = nodeExec.OutputArtifactDir ?? string.Empty,
                ConfigJson = nodeDef.ConfigJson
            }, ct);
        }

        execution.Status = WorkflowExecutionStatus.Running;
        await db.SaveChangesAsync(ct);

        _logger.LogInformation("Started execution {ExecutionId} for workflow {WorkflowId}", execution.Id, workflow.Id);

        return Ok(new WorkflowExecutionDto(
            execution.Id,
            execution.WorkflowId,
            execution.WorkflowVersionId,
            workflow.Name,
            new FileRecordDto(fileRecord.Id, fileRecord.OriginalFileName, fileRecord.ContentType, fileRecord.SizeBytes, fileRecord.CreatedAt),
            execution.Status.ToString(),
            nodeExecs.Select(ne =>
            {
                var def = rootNodes.FirstOrDefault(n => n.Id == ne.WorkflowNodeId);
                return new NodeExecutionDto(
                    ne.Id, ne.WorkflowNodeId, ne.Attempt, ne.Status.ToString(), ne.OutputArtifactDir,
                    ne.OutputArtifactPathsJson != null ? JsonSerializer.Deserialize<Dictionary<string, string>>(ne.OutputArtifactPathsJson) ?? new() : new(),
                    ne.ErrorMessage, ne.StartedAt, ne.CompletedAt,
                    def != null ? $"Node {def.Order + 1}" : null,
                    def != null ? ExtractModelName(def.ConfigJson) : null);
            }).ToList(),
            execution.CreatedAt,
            execution.CompletedAt,
            execution.ErrorMessage));
    }

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

    private static List<WorkflowNodeDefinition> DeserializeNodes(string json) =>
        JsonSerializer.Deserialize<List<WorkflowNodeDefinition>>(json) ?? new();

    private static WorkflowDto ToDto(Workflow w, WorkflowVersion version, List<WorkflowNodeDefinition> nodes) => new(
        w.Id,
        w.Name,
        nodes.OrderBy(n => n.Order).Select(n => new WorkflowNodeDto(n.Id, n.Order, n.NodeType, n.ConfigJson, n.SourceNodeId, n.SourceOutputName)).ToList(),
        w.CreatedAt,
        w.UpdatedAt);
}
