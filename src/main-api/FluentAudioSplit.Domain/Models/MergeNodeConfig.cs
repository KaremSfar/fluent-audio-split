namespace FluentAudioSplit.Domain.Models;

/// <summary>Shape of <c>ConfigJson</c> for a Merge node (camelCase JSON).</summary>
public record MergeNodeConfig(string? Label, List<double>? InputGainsDb, string? LevelMode, double? CeilingDb);
