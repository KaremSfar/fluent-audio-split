using System.Security.Claims;
using FluentAudioSplit.Api.Dtos;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Controllers;

/// <summary>The per-execution result set: kept / default / manually added stems.</summary>
[ApiController]
[Route("api/executions/{id:guid}/results")]
[Authorize]
public class ExecutionResultsController : ControllerBase
{
    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly ResultTrackService _results;

    public ExecutionResultsController(IDbContextFactory<ApplicationDbContext> dbFactory, ResultTrackService results)
    {
        _dbFactory = dbFactory;
        _results = results;
    }

    private Task<WorkflowExecution?> LoadAsync(ApplicationDbContext db, Guid id, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        return db.WorkflowExecutions
            .Include(we => we.WorkflowVersion).ThenInclude(v => v.Workflow)
            .Include(we => we.InputFileRecord)
            .FirstOrDefaultAsync(we => we.Id == id && we.UserId == userId, ct);
    }

    [HttpGet]
    public async Task<ActionResult<ExecutionResultsDto>> Get(Guid id, CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        var execution = await LoadAsync(db, id, ct);
        if (execution is null) return NotFound();
        return Ok(await _results.BuildResultsAsync(db, execution, ct));
    }

    [HttpPost("tracks")]
    public async Task<ActionResult<ResultTrackDto>> AddTrack(Guid id, [FromBody] AddResultTrackRequest request, CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        var execution = await LoadAsync(db, id, ct);
        if (execution is null) return NotFound();

        var outcome = await _results.AddManualAsync(db, execution, request.WorkflowNodeId, request.OutputName, ct);
        switch (outcome)
        {
            case AddTrackOutcome.Conflict:
                return Problem("This stem is already a result track.", statusCode: StatusCodes.Status409Conflict);
            case AddTrackOutcome.NotAnOutput:
                return Problem("That is not a completed output of the given node.", statusCode: StatusCodes.Status400BadRequest);
        }

        var dto = await _results.GetTrackDtoAsync(db, execution, request.WorkflowNodeId, request.OutputName, ct);
        return Created($"/api/executions/{id}/results", dto);
    }

    [HttpDelete("tracks/{trackId:guid}")]
    public async Task<IActionResult> RemoveTrack(Guid id, Guid trackId, CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        var execution = await LoadAsync(db, id, ct);
        if (execution is null) return NotFound();
        return await _results.RemoveAsync(db, id, trackId, ct) ? NoContent() : NotFound();
    }
}
