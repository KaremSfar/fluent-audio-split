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
    private readonly NodeDispatcher _dispatcher;
    private readonly ResultTrackService _results;
    private readonly ILogger<WorkflowsController> _logger;

    public WorkflowsController(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        NodeDispatcher dispatcher,
        ResultTrackService results,
        ILogger<WorkflowsController> logger)
    {
        _dbFactory = dbFactory;
        _dispatcher = dispatcher;
        _results = results;
        _logger = logger;
    }

    private ActionResult InvalidWorkflow(IReadOnlyList<string> errors) =>
        ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
        {
            ["nodes"] = errors.ToArray()
        })
        {
            Status = StatusCodes.Status400BadRequest,
            Title = "The workflow is invalid.",
        });

    private static WorkflowNodeDefinition ToDefinition(Guid? id, int order, string nodeType, string configJson,
        List<NodeInputDto>? inputs, List<string>? keptOutputs) => new()
    {
        // Client-supplied ids are kept as given: inputs reference them, so they must not change.
        Id = id ?? Guid.NewGuid(),
        Order = order,
        NodeType = nodeType,
        ConfigJson = string.IsNullOrWhiteSpace(configJson) ? "{}" : configJson,
        Inputs = (inputs ?? new()).Select(i => new NodeInputDefinition(i.SourceNodeId, i.SourceOutputName)).ToList(),
        KeptOutputs = (keptOutputs ?? new()).Distinct().ToList(),
    };

    [HttpPost]
    public async Task<ActionResult<WorkflowDto>> Create([FromBody] CreateWorkflowRequest request, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;

        var nodeDefs = request.Nodes
            .Select(n => ToDefinition(n.Id, n.Order, n.NodeType, n.ConfigJson, n.Inputs, n.KeptOutputs)).ToList();

        var errors = WorkflowGraph.Validate(nodeDefs);
        if (errors.Count > 0) return InvalidWorkflow(errors);

        var workflow = new Workflow
        {
            Name = request.Name,
            UserId = userId,
        };

        var version = new WorkflowVersion
        {
            WorkflowId = workflow.Id,
            VersionNumber = 1,
            StructureJson = WorkflowJson.Serialize(nodeDefs),
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
            .Where(w => w.UserId == userId && w.DeletedAt == null)
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
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId && w.DeletedAt == null, ct);

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
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId && w.DeletedAt == null, ct);

        if (workflow is null) return NotFound();

        workflow.Name = request.Name;
        workflow.UpdatedAt = DateTime.UtcNow;

        var maxVersion = workflow.Versions.Max(v => v.VersionNumber);

        var nodeDefs = request.Nodes
            .Select(n => ToDefinition(n.Id, n.Order, n.NodeType, n.ConfigJson, n.Inputs, n.KeptOutputs)).ToList();

        var errors = WorkflowGraph.Validate(nodeDefs);
        if (errors.Count > 0) return InvalidWorkflow(errors);

        var newVersion = new WorkflowVersion
        {
            WorkflowId = id,
            VersionNumber = maxVersion + 1,
            StructureJson = WorkflowJson.Serialize(nodeDefs),
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

        var workflow = await db.Workflows
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId && w.DeletedAt == null, ct);
        if (workflow is null) return NotFound();

        workflow.DeletedAt = DateTime.UtcNow;
        workflow.UpdatedAt = workflow.DeletedAt.Value;
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
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId && w.DeletedAt == null, ct);

        if (workflow is null) return NotFound("Workflow not found.");

        var latestVersion = workflow.Versions.OrderByDescending(v => v.VersionNumber).First();
        var nodeDefs = DeserializeNodes(latestVersion.StructureJson);

        var fileRecord = await db.FileRecords
            .FirstOrDefaultAsync(f => f.Id == request.FileId && f.UserId == userId, ct);

        if (fileRecord is null) return NotFound("File not found.");

        var errors = WorkflowGraph.Validate(nodeDefs);
        if (errors.Count > 0) return InvalidWorkflow(errors);

        var execution = new WorkflowExecution
        {
            WorkflowId = workflow.Id,
            WorkflowVersionId = latestVersion.Id,
            UserId = userId,
            InputFileRecordId = fileRecord.Id,
            InputFileRecord = fileRecord,
            // Running up-front: a fast worker could otherwise complete a node before we flip the
            // status and the reconciler's terminal state would be overwritten.
            Status = WorkflowExecutionStatus.Running,
            TrimStartSeconds = request.TrimStartSeconds,
            TrimEndSeconds = request.TrimEndSeconds
        };

        db.WorkflowExecutions.Add(execution);
        await db.SaveChangesAsync(ct);

        await _results.SeedKeptAsync(db, execution, nodeDefs, ct);

        var nodeExecs = new List<NodeExecution>();
        foreach (var root in nodeDefs.Where(n => n.IsRoot).OrderBy(n => n.Order))
        {
            var nodeExec = await _dispatcher.DispatchAsync(db, execution, nodeDefs, root, 1, ct);
            if (nodeExec is not null) nodeExecs.Add(nodeExec);
        }

        _logger.LogInformation("Started execution {ExecutionId} for workflow {WorkflowId}", execution.Id, workflow.Id);

        var defsById = nodeDefs.ToDictionary(d => d.Id);
        return Ok(new WorkflowExecutionDto(
            execution.Id,
            execution.WorkflowId,
            execution.WorkflowVersionId,
            workflow.Name,
            new FileRecordDto(fileRecord.Id, fileRecord.OriginalFileName, fileRecord.ContentType, fileRecord.SizeBytes, fileRecord.CreatedAt, fileRecord.ContentHash),
            execution.Status.ToString(),
            nodeExecs.Select(ne => WorkflowMapping.ToDto(ne, defsById.GetValueOrDefault(ne.WorkflowNodeId))).ToList(),
            execution.CreatedAt,
            execution.CompletedAt,
            execution.ErrorMessage,
            execution.TrimStartSeconds,
            execution.TrimEndSeconds));
    }

    private static List<WorkflowNodeDefinition> DeserializeNodes(string json) => WorkflowJson.DeserializeNodes(json);

    private static WorkflowDto ToDto(Workflow w, WorkflowVersion version, List<WorkflowNodeDefinition> nodes) => new(
        w.Id,
        w.Name,
        version.Id,
        nodes.OrderBy(n => n.Order).Select(n => new WorkflowNodeDto(
            n.Id, n.Order, n.NodeType, n.ConfigJson,
            n.Inputs.Select(i => new NodeInputDto(i.SourceNodeId, i.SourceOutputName)).ToList(),
            n.KeptOutputs.ToList())).ToList(),
        w.CreatedAt,
        w.UpdatedAt);
}
