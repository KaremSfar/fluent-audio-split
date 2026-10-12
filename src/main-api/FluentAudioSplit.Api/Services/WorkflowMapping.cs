using System.Text.Json;
using FluentAudioSplit.Api.Dtos;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;

namespace FluentAudioSplit.Api.Services;

/// <summary>Shared mapping helpers (node definitions / executions → DTOs).</summary>
public static class WorkflowMapping
{
    public static string? ExtractModelName(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return null;
        try
        {
            using var doc = JsonDocument.Parse(configJson);
            return doc.RootElement.TryGetProperty("modelName", out var m) ? m.GetString() : null;
        }
        catch { return null; }
    }

    public static string NodeLabel(WorkflowNodeDefinition def) => $"Node {def.Order + 1}";

    public static Dictionary<string, string> ParseOutputs(string? outputJson) =>
        string.IsNullOrEmpty(outputJson)
            ? new()
            : JsonSerializer.Deserialize<Dictionary<string, string>>(outputJson) ?? new();

    public static NodeExecutionDto ToDto(NodeExecution ne, WorkflowNodeDefinition? def = null)
    {
        var nodeType = def?.NodeType ?? ne.NodeType;
        return new NodeExecutionDto(
            ne.Id,
            ne.WorkflowNodeId,
            ne.Attempt,
            ne.Status.ToString(),
            ne.OutputArtifactDir,
            ParseOutputs(ne.OutputArtifactPathsJson),
            ne.ErrorMessage,
            ne.StartedAt,
            ne.CompletedAt,
            def != null ? NodeLabel(def) : null,
            nodeType == NodeTypes.Merge ? null : ExtractModelName(def?.ConfigJson),
            nodeType);
    }
}
