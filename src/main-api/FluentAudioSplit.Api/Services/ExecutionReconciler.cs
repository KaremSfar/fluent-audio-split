using System.Text.Json;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
using FluentAudioSplit.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Services;

/// <summary>
/// Decides the terminal status of a <see cref="WorkflowExecution"/> once its nodes settle.
///
/// The previous design marked an execution <c>PartiallyFailed</c> on the FIRST node failure and
/// required EVERY workflow node to reach <c>Completed</c> before it could be <c>Completed</c>.
/// On branched graphs that froze still-running sibling branches and left the execution stuck in
/// <c>PartiallyFailed</c> forever. This reconciler instead waits until no node is still in flight
/// (Pending/Queued/Running) and only then picks a terminal state — so live branches keep running
/// and a truly-terminal event is emitted exactly once.
/// </summary>
public static class ExecutionReconciler
{
    /// <summary>
    /// Recomputes and persists the execution's terminal status if — and only if — it has just
    /// become terminal. Returns the new terminal status (to publish a matching SSE event), or
    /// <c>null</c> if the execution is still running or was already terminal.
    /// </summary>
    public static async Task<WorkflowExecutionStatus?> ReconcileAsync(
        ApplicationDbContext db, Guid executionId, CancellationToken ct)
    {
        var exec = await db.WorkflowExecutions
            .Include(we => we.WorkflowVersion)
            .Include(we => we.NodeExecutions)
            .FirstOrDefaultAsync(we => we.Id == executionId, ct);

        if (exec is null) return null;

        // Already terminal (including an explicit Cancel) — never re-emit or overwrite.
        if (IsTerminal(exec.Status)) return null;

        // Any node still in flight → not terminal yet; leave the execution Running so parallel
        // branches keep streaming.
        var inFlight = exec.NodeExecutions.Any(ne =>
            ne.Status is NodeExecutionStatus.Pending
                or NodeExecutionStatus.Queued
                or NodeExecutionStatus.Running);
        if (inFlight) return null;

        var nodeDefs = JsonSerializer.Deserialize<List<WorkflowNodeDefinition>>(
            exec.WorkflowVersion.StructureJson) ?? new();
        var allNodeIds = nodeDefs.Select(n => n.Id).ToHashSet();

        // Latest attempt per workflow node decides that node's outcome (a retry supersedes a
        // prior failure).
        var completedNodeIds = exec.NodeExecutions
            .GroupBy(ne => ne.WorkflowNodeId)
            .Select(g => g.OrderByDescending(ne => ne.Attempt).First())
            .Where(ne => ne.Status == NodeExecutionStatus.Completed)
            .Select(ne => ne.WorkflowNodeId)
            .ToHashSet();

        WorkflowExecutionStatus terminal;
        if (allNodeIds.Count > 0 && allNodeIds.All(completedNodeIds.Contains))
            terminal = WorkflowExecutionStatus.Completed;
        else if (completedNodeIds.Count > 0)
            terminal = WorkflowExecutionStatus.PartiallyFailed;
        else
            terminal = WorkflowExecutionStatus.Failed;

        exec.Status = terminal;
        exec.CompletedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return terminal;
    }

    public static bool IsTerminal(WorkflowExecutionStatus status) =>
        status is WorkflowExecutionStatus.Completed
            or WorkflowExecutionStatus.PartiallyFailed
            or WorkflowExecutionStatus.Failed
            or WorkflowExecutionStatus.Cancelled;

    /// <summary>Maps a terminal status to its SSE event <c>type</c> string.</summary>
    public static string ToEventType(WorkflowExecutionStatus status) => status switch
    {
        WorkflowExecutionStatus.Completed => "ExecutionCompleted",
        WorkflowExecutionStatus.PartiallyFailed => "ExecutionPartiallyFailed",
        WorkflowExecutionStatus.Failed => "ExecutionFailed",
        WorkflowExecutionStatus.Cancelled => "ExecutionCancelled",
        _ => "ExecutionRunning",
    };
}
