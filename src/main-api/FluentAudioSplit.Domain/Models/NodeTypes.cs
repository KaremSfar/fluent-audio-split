namespace FluentAudioSplit.Domain.Models;

public static class NodeTypes
{
    public const string AudioSeparation = "AudioSeparation";
    public const string Merge = "Merge";

    /// <summary>The single, stable output handle of a Merge node.</summary>
    public const string MergeOutputName = "Mix";

    public const int MergeMinInputs = 2;
    public const int MergeMaxInputs = 8;

    public static bool IsKnown(string? nodeType) => nodeType is AudioSeparation or Merge;
}
