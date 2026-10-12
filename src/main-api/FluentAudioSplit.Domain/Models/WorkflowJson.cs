using System.Text.Json;

namespace FluentAudioSplit.Domain.Models;

/// <summary>Single place for (de)serializing workflow structure/config JSON with camelCase casing.</summary>
public static class WorkflowJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static List<WorkflowNodeDefinition> DeserializeNodes(string? json) =>
        string.IsNullOrWhiteSpace(json)
            ? new()
            : JsonSerializer.Deserialize<List<WorkflowNodeDefinition>>(json, Options) ?? new();

    /// <summary>Parses a Merge node's config; returns null when it is missing or malformed.</summary>
    public static MergeNodeConfig? ParseMergeConfig(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return new MergeNodeConfig(null, null, null, null);
        try { return JsonSerializer.Deserialize<MergeNodeConfig>(configJson, Options); }
        catch (JsonException) { return null; }
    }
}
