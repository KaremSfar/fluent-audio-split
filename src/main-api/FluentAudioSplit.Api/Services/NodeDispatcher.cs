using FluentAudioSplit.Api.Messages;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
using FluentAudioSplit.Infrastructure.Persistence;
using MassTransit;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Services;

public enum InputResolutionStatus
{
    /// <summary>All inputs are available.</summary>
    Ready,
    /// <summary>At least one source node has not (successfully) completed yet.</summary>
    Waiting,
    /// <summary>A source completed but did not produce the required output.</summary>
    MissingOutput,
}

public record ResolvedInputs(
    InputResolutionStatus Status,
    string InputArtifactPath,
    List<NodeInputArtifact> InputArtifacts,
    double? TrimStartSeconds,
    double? TrimEndSeconds,
    string? Error)
{
    public static ResolvedInputs Waiting() => new(InputResolutionStatus.Waiting, "", new(), null, null, null);
    public static ResolvedInputs Missing(string error) => new(InputResolutionStatus.MissingOutput, "", new(), null, null, error);
}

/// <summary>
/// The single place that turns a workflow node definition into a <see cref="NodeExecution"/> row +
/// <see cref="ProcessNodeCommand"/>. Used by Execute, RetryNode, auto-retry and downstream chaining.
/// </summary>
public class NodeDispatcher
{
    public const string ProcessNodeQueue = "queue:process-node";

    private readonly ISendEndpointProvider _sendEndpoint;
    private readonly ILogger<NodeDispatcher> _logger;

    public NodeDispatcher(ISendEndpointProvider sendEndpoint, ILogger<NodeDispatcher> logger)
    {
        _sendEndpoint = sendEndpoint;
        _logger = logger;
    }

    /// <summary>
    /// Resolves a node's inputs: a root Split reads the execution's input file; otherwise each
    /// input comes from the latest attempt of its source node. There is deliberately NO fallback
    /// to "the first output" — a missing named output is reported as <see cref="InputResolutionStatus.MissingOutput"/>.
    /// </summary>
    public async Task<ResolvedInputs> ResolveInputsAsync(
        ApplicationDbContext db, WorkflowExecution exec, IReadOnlyList<WorkflowNodeDefinition> defs,
        WorkflowNodeDefinition def, CancellationToken ct)
    {
        if (def.IsRoot)
        {
            if (def.NodeType == NodeTypes.Merge)
                return ResolvedInputs.Missing("A Merge node needs inputs.");

            var path = exec.InputFileRecord?.StoragePath;
            if (path is null)
            {
                path = await db.FileRecords.Where(f => f.Id == exec.InputFileRecordId)
                    .Select(f => f.StoragePath).FirstOrDefaultAsync(ct);
            }
            if (string.IsNullOrEmpty(path))
                return ResolvedInputs.Missing("The execution's input file could not be found.");
            return new ResolvedInputs(InputResolutionStatus.Ready, path, new(), exec.TrimStartSeconds, exec.TrimEndSeconds, null);
        }

        var sourceIds = def.Inputs.Select(i => i.SourceNodeId).Distinct().ToList();
        var rows = await db.NodeExecutions.AsNoTracking()
            .Where(ne => ne.WorkflowExecutionId == exec.Id && sourceIds.Contains(ne.WorkflowNodeId))
            .ToListAsync(ct);
        var latest = rows.GroupBy(r => r.WorkflowNodeId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.Attempt).First());

        var gains = def.NodeType == NodeTypes.Merge
            ? WorkflowJson.ParseMergeConfig(def.ConfigJson)?.InputGainsDb
            : null;

        var artifacts = new List<NodeInputArtifact>();
        var waiting = false;
        string? missing = null;

        for (var i = 0; i < def.Inputs.Count; i++)
        {
            var input = def.Inputs[i];
            if (!latest.TryGetValue(input.SourceNodeId, out var src) || src.Status != NodeExecutionStatus.Completed)
            {
                waiting = true;
                continue;
            }
            var outputs = WorkflowMapping.ParseOutputs(src.OutputArtifactPathsJson);
            if (!outputs.TryGetValue(input.SourceOutputName, out var path) || string.IsNullOrEmpty(path))
            {
                var srcDef = defs.FirstOrDefault(d => d.Id == input.SourceNodeId);
                var srcLabel = srcDef is null ? input.SourceNodeId.ToString() : WorkflowMapping.NodeLabel(srcDef);
                missing ??= $"Input '{input.SourceOutputName}' from {srcLabel} was not produced.";
                continue;
            }
            artifacts.Add(new NodeInputArtifact
            {
                Path = path,
                Label = input.SourceOutputName,
                GainDb = gains is not null && i < gains.Count ? gains[i] : 0.0,
            });
        }

        if (missing is not null) return ResolvedInputs.Missing(missing);
        if (waiting) return ResolvedInputs.Waiting();

        return def.NodeType == NodeTypes.Merge
            ? new ResolvedInputs(InputResolutionStatus.Ready, "", artifacts, null, null, null)
            : new ResolvedInputs(InputResolutionStatus.Ready, artifacts[0].Path, new(), null, null, null);
    }

    /// <summary>
    /// Creates the NodeExecution row (Queued) and sends the ProcessNodeCommand. Returns null when
    /// nothing was dispatched: a row for (execution, node, attempt) already exists (idempotency /
    /// lost race on the unique index), or the inputs are not available.
    /// </summary>
    public async Task<NodeExecution?> DispatchAsync(
        ApplicationDbContext db, WorkflowExecution exec, IReadOnlyList<WorkflowNodeDefinition> defs,
        WorkflowNodeDefinition def, int attempt, CancellationToken ct)
    {
        var resolved = await ResolveInputsAsync(db, exec, defs, def, ct);
        if (resolved.Status != InputResolutionStatus.Ready)
        {
            _logger.LogInformation("Not dispatching node {NodeId} of execution {ExecId}: inputs {Status}",
                def.Id, exec.Id, resolved.Status);
            return null;
        }

        var nodeExec = new NodeExecution
        {
            WorkflowExecutionId = exec.Id,
            WorkflowNodeId = def.Id,
            NodeType = def.NodeType,
            Attempt = attempt,
            Status = NodeExecutionStatus.Queued,
            InputArtifactPath = def.NodeType == NodeTypes.Merge ? null : resolved.InputArtifactPath,
            InputArtifactsJson = def.NodeType == NodeTypes.Merge ? WorkflowJson.Serialize(resolved.InputArtifacts) : null,
            OutputArtifactDir = $"executions/{exec.Id}/nodes/{Guid.NewGuid()}/",
        };

        if (!await TryInsertAsync(db, nodeExec, ct)) return null;

        var endpoint = await _sendEndpoint.GetSendEndpoint(new Uri(ProcessNodeQueue));
        await endpoint.Send(new ProcessNodeCommand
        {
            WorkflowExecutionId = exec.Id,
            NodeExecutionId = nodeExec.Id,
            NodeType = def.NodeType,
            InputArtifactPath = nodeExec.InputArtifactPath ?? string.Empty,
            InputArtifacts = resolved.InputArtifacts,
            OutputArtifactDir = nodeExec.OutputArtifactDir,
            ConfigJson = def.ConfigJson,
            TrimStartSeconds = resolved.TrimStartSeconds,
            TrimEndSeconds = resolved.TrimEndSeconds,
        }, ct);

        return nodeExec;
    }

    /// <summary>
    /// Records a dependent node as Failed without dispatching it (e.g. an upstream output was not
    /// produced). Returns null if a row for (execution, node, attempt 1) already exists.
    /// </summary>
    public async Task<NodeExecution?> FailAsync(
        ApplicationDbContext db, WorkflowExecution exec, WorkflowNodeDefinition def, string error, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var nodeExec = new NodeExecution
        {
            WorkflowExecutionId = exec.Id,
            WorkflowNodeId = def.Id,
            NodeType = def.NodeType,
            Attempt = 1,
            Status = NodeExecutionStatus.Failed,
            ErrorMessage = error,
            CompletedAt = now,
        };
        return await TryInsertAsync(db, nodeExec, ct) ? nodeExec : null;
    }

    private async Task<bool> TryInsertAsync(ApplicationDbContext db, NodeExecution nodeExec, CancellationToken ct)
    {
        // Fast path for idempotency; the unique index (exec, node, attempt) is the real guard
        // against concurrent consumers (e.g. two parents of one Merge completing at once).
        var exists = await db.NodeExecutions.AnyAsync(ne =>
            ne.WorkflowExecutionId == nodeExec.WorkflowExecutionId
            && ne.WorkflowNodeId == nodeExec.WorkflowNodeId
            && ne.Attempt == nodeExec.Attempt, ct);
        if (exists) return false;

        db.NodeExecutions.Add(nodeExec);
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException ex)
        {
            db.Entry(nodeExec).State = EntityState.Detached;
            _logger.LogInformation(ex,
                "NodeExecution for node {NodeId} attempt {Attempt} (execution {ExecId}) already exists; skipping",
                nodeExec.WorkflowNodeId, nodeExec.Attempt, nodeExec.WorkflowExecutionId);
            return false;
        }
    }
}
