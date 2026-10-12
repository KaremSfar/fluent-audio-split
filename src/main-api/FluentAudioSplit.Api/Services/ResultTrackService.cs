using FluentAudioSplit.Api.Dtos;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
using FluentAudioSplit.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Services;

public enum AddTrackOutcome { Created, Conflict, NotAnOutput }

/// <summary>Seeds, queries and edits the per-execution result tracks.</summary>
public class ResultTrackService
{
    /// <summary>Explicit mode: one Kept row per (node, keptOutput), in definition order.</summary>
    public async Task SeedKeptAsync(
        ApplicationDbContext db, WorkflowExecution exec, IReadOnlyList<WorkflowNodeDefinition> defs, CancellationToken ct)
    {
        if (!WorkflowGraph.HasExplicitKeeps(defs)) return;

        foreach (var def in defs.OrderBy(d => d.Order))
        {
            var idx = 0;
            foreach (var output in def.KeptOutputs.Distinct())
            {
                db.ResultTracks.Add(new ResultTrack
                {
                    WorkflowExecutionId = exec.Id,
                    WorkflowNodeId = def.Id,
                    OutputName = output,
                    Origin = ResultTrackOrigin.Kept,
                    SortOrder = def.Order * 100 + idx++,
                });
            }
        }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Default mode only: every produced output that no other node consumes becomes a Default row.
    /// Existing rows (e.g. from a retry) are left untouched.
    /// </summary>
    public async Task OnNodeCompletedAsync(
        ApplicationDbContext db, WorkflowExecution exec, IReadOnlyList<WorkflowNodeDefinition> defs,
        NodeExecution nodeExec, IReadOnlyDictionary<string, string> outputs, CancellationToken ct)
    {
        if (WorkflowGraph.HasExplicitKeeps(defs)) return;
        var def = defs.FirstOrDefault(d => d.Id == nodeExec.WorkflowNodeId);
        if (def is null) return;

        var existing = await db.ResultTracks
            .Where(rt => rt.WorkflowExecutionId == exec.Id && rt.WorkflowNodeId == def.Id)
            .Select(rt => rt.OutputName).ToListAsync(ct);

        var idx = 0;
        foreach (var output in outputs.Keys.OrderBy(k => k, StringComparer.Ordinal))
        {
            var sort = def.Order * 100 + idx++;
            if (WorkflowGraph.IsConsumed(defs, def.Id, output) || existing.Contains(output)) continue;

            var row = new ResultTrack
            {
                WorkflowExecutionId = exec.Id,
                WorkflowNodeId = def.Id,
                OutputName = output,
                Origin = ResultTrackOrigin.Default,
                SortOrder = sort,
            };
            db.ResultTracks.Add(row);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) { db.Entry(row).State = EntityState.Detached; }
        }
    }

    public async Task<AddTrackOutcome> AddManualAsync(
        ApplicationDbContext db, WorkflowExecution exec, Guid nodeId, string outputName, CancellationToken ct)
    {
        var latest = await LatestAttemptsAsync(db, exec.Id, ct);
        if (!latest.TryGetValue(nodeId, out var ne) || ne.Status != NodeExecutionStatus.Completed
            || !WorkflowMapping.ParseOutputs(ne.OutputArtifactPathsJson).ContainsKey(outputName))
            return AddTrackOutcome.NotAnOutput;

        var exists = await db.ResultTracks.AnyAsync(rt =>
            rt.WorkflowExecutionId == exec.Id && rt.WorkflowNodeId == nodeId && rt.OutputName == outputName, ct);
        if (exists) return AddTrackOutcome.Conflict;

        var max = await db.ResultTracks.Where(rt => rt.WorkflowExecutionId == exec.Id)
            .Select(rt => (int?)rt.SortOrder).MaxAsync(ct);
        var row = new ResultTrack
        {
            WorkflowExecutionId = exec.Id,
            WorkflowNodeId = nodeId,
            OutputName = outputName,
            Origin = ResultTrackOrigin.Manual,
            SortOrder = (max ?? -1) + 1,
        };
        db.ResultTracks.Add(row);
        try
        {
            await db.SaveChangesAsync(ct);
            return AddTrackOutcome.Created;
        }
        catch (DbUpdateException)
        {
            db.Entry(row).State = EntityState.Detached;
            return AddTrackOutcome.Conflict;
        }
    }

    public async Task<ResultTrackDto?> GetTrackDtoAsync(
        ApplicationDbContext db, WorkflowExecution exec, Guid nodeId, string outputName, CancellationToken ct)
    {
        var dto = await BuildResultsAsync(db, exec, ct);
        return dto.Tracks.FirstOrDefault(t => t.WorkflowNodeId == nodeId && t.OutputName == outputName);
    }

    public async Task<bool> RemoveAsync(ApplicationDbContext db, Guid executionId, Guid trackId, CancellationToken ct)
    {
        var row = await db.ResultTracks.FirstOrDefaultAsync(
            rt => rt.Id == trackId && rt.WorkflowExecutionId == executionId, ct);
        if (row is null) return false;
        db.ResultTracks.Remove(row);
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>Builds the Results DTO; <paramref name="exec"/> must include WorkflowVersion(+Workflow) and InputFileRecord.</summary>
    public async Task<ExecutionResultsDto> BuildResultsAsync(ApplicationDbContext db, WorkflowExecution exec, CancellationToken ct)
    {
        var defs = WorkflowJson.DeserializeNodes(exec.WorkflowVersion.StructureJson);
        var defsById = defs.ToDictionary(d => d.Id);
        var latest = await LatestAttemptsAsync(db, exec.Id, ct);
        var rows = await db.ResultTracks.AsNoTracking()
            .Where(rt => rt.WorkflowExecutionId == exec.Id).ToListAsync(ct);
        rows = rows.OrderBy(r => r.SortOrder).ThenBy(r => r.CreatedAt).ToList();

        var trackKeys = rows.Select(r => (r.WorkflowNodeId, r.OutputName)).ToHashSet();

        // Available = every completed (node, output) that is not already a track.
        var available = new List<(WorkflowNodeDefinition Def, string Output, string Path)>();
        foreach (var def in defs.OrderBy(d => d.Order))
        {
            if (!latest.TryGetValue(def.Id, out var ne) || ne.Status != NodeExecutionStatus.Completed) continue;
            foreach (var (output, path) in WorkflowMapping.ParseOutputs(ne.OutputArtifactPathsJson).OrderBy(kv => kv.Key, StringComparer.Ordinal))
                if (!trackKeys.Contains((def.Id, output))) available.Add((def, output, path));
        }

        var trackNameCounts = rows.GroupBy(r => r.OutputName).ToDictionary(g => g.Key, g => g.Count());
        var allNameCounts = rows.Select(r => r.OutputName).Concat(available.Select(a => a.Output))
            .GroupBy(n => n).ToDictionary(g => g.Key, g => g.Count());

        string Display(WorkflowNodeDefinition? def, string output, Dictionary<string, int> counts)
        {
            if (def is null) return output;
            if (def.NodeType == NodeTypes.Merge)
            {
                var label = WorkflowJson.ParseMergeConfig(def.ConfigJson)?.Label;
                return !string.IsNullOrWhiteSpace(label)
                    ? label
                    : string.Join(" + ", def.Inputs.Select(i => i.SourceOutputName));
            }
            return counts.GetValueOrDefault(output) > 1 ? $"{output} ({WorkflowMapping.NodeLabel(def)})" : output;
        }

        var tracks = rows.Select(r =>
        {
            defsById.TryGetValue(r.WorkflowNodeId, out var def);
            latest.TryGetValue(r.WorkflowNodeId, out var ne);
            string state; string? path = null; string? error = null;
            if (ne is null) state = "Pending";
            else switch (ne.Status)
            {
                case NodeExecutionStatus.Completed:
                    if (WorkflowMapping.ParseOutputs(ne.OutputArtifactPathsJson).TryGetValue(r.OutputName, out path))
                        state = "Ready";
                    else { state = "Missing"; path = null; }
                    break;
                case NodeExecutionStatus.Failed: state = "Failed"; error = ne.ErrorMessage; break;
                case NodeExecutionStatus.Cancelled: state = "Cancelled"; break;
                default: state = "Pending"; break;
            }
            var nodeType = def?.NodeType ?? ne?.NodeType ?? NodeTypes.AudioSeparation;
            return new ResultTrackDto(
                r.Id, r.WorkflowNodeId, r.OutputName, Display(def, r.OutputName, trackNameCounts),
                r.Origin.ToString(), r.SortOrder, state, path, error,
                def is null ? "Unknown node" : WorkflowMapping.NodeLabel(def), nodeType,
                nodeType == NodeTypes.Merge ? null : WorkflowMapping.ExtractModelName(def?.ConfigJson));
        }).ToList();

        var availableDtos = available.Select(a => new AvailableStemDto(
            a.Def.Id, a.Output, Display(a.Def, a.Output, allNameCounts), WorkflowMapping.NodeLabel(a.Def), a.Path)).ToList();

        var f = exec.InputFileRecord;
        return new ExecutionResultsDto(
            exec.Id, exec.WorkflowId, exec.WorkflowVersion.Workflow?.Name ?? string.Empty, exec.Status.ToString(),
            f is not null
                ? new FileRecordDto(f.Id, f.OriginalFileName, f.ContentType, f.SizeBytes, f.CreatedAt, f.ContentHash)
                : new FileRecordDto(exec.InputFileRecordId, string.Empty, string.Empty, 0, DateTime.MinValue, null),
            exec.TrimStartSeconds, exec.TrimEndSeconds,
            WorkflowGraph.HasExplicitKeeps(defs) ? "Explicit" : "Default",
            tracks, availableDtos);
    }

    private static async Task<Dictionary<Guid, NodeExecution>> LatestAttemptsAsync(
        ApplicationDbContext db, Guid executionId, CancellationToken ct)
    {
        var rows = await db.NodeExecutions.AsNoTracking()
            .Where(ne => ne.WorkflowExecutionId == executionId).ToListAsync(ct);
        return rows.GroupBy(r => r.WorkflowNodeId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.Attempt).First());
    }
}
