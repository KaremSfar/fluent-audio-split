namespace FluentAudioSplit.Domain.Models;

/// <summary>
/// Pure, side-effect-free graph helpers over a workflow version's node definitions.
/// The validation rules (V1–V9) are mirrored by <c>validateWorkflow</c> in the frontend; this
/// implementation is authoritative.
/// </summary>
public static class WorkflowGraph
{
    public const double MinGainDb = -60;
    public const double MaxGainDb = 12;

    public static IReadOnlyList<string> Validate(IReadOnlyList<WorkflowNodeDefinition> nodes)
    {
        var errors = new List<string>();
        string Label(WorkflowNodeDefinition n) => $"Node {n.Order + 1}";

        // V1: ids unique and non-empty.
        var seen = new HashSet<Guid>();
        foreach (var n in nodes)
        {
            if (n.Id == Guid.Empty) errors.Add($"{Label(n)}: id must be a non-empty GUID.");
            else if (!seen.Add(n.Id)) errors.Add($"{Label(n)}: duplicate node id {n.Id}.");
        }

        var byId = new Dictionary<Guid, WorkflowNodeDefinition>();
        foreach (var n in nodes) byId.TryAdd(n.Id, n);

        foreach (var n in nodes)
        {
            var label = Label(n);
            var inputs = n.Inputs ?? new();

            // V9: known node type.
            if (!NodeTypes.IsKnown(n.NodeType))
            {
                errors.Add($"{label}: unknown node type '{n.NodeType}'.");
                continue;
            }

            // V3 / V4: input arity.
            if (n.NodeType == NodeTypes.AudioSeparation && inputs.Count > 1)
                errors.Add($"{label}: a Split node accepts at most 1 input (has {inputs.Count}).");
            if (n.NodeType == NodeTypes.Merge &&
                (inputs.Count < NodeTypes.MergeMinInputs || inputs.Count > NodeTypes.MergeMaxInputs))
                errors.Add($"{label}: a Merge node needs {NodeTypes.MergeMinInputs}-{NodeTypes.MergeMaxInputs} inputs (has {inputs.Count}).");

            // V5: inputs reference existing nodes / valid outputs.
            foreach (var input in inputs)
            {
                if (!byId.TryGetValue(input.SourceNodeId, out var source))
                {
                    errors.Add($"{label}: input references missing node {input.SourceNodeId}.");
                    continue;
                }
                if (string.IsNullOrWhiteSpace(input.SourceOutputName))
                    errors.Add($"{label}: input from {Label(source)} has an empty output name.");
                else if (source.NodeType == NodeTypes.Merge && input.SourceOutputName != NodeTypes.MergeOutputName)
                    errors.Add($"{label}: a Merge node only outputs '{NodeTypes.MergeOutputName}', not '{input.SourceOutputName}'.");
            }

            if (n.NodeType == NodeTypes.Merge)
            {
                // V6: no duplicate (source, output) pairs within one Merge.
                var dup = inputs.GroupBy(i => (i.SourceNodeId, i.SourceOutputName)).Any(g => g.Count() > 1);
                if (dup) errors.Add($"{label}: the same stem is connected more than once.");

                // V7: gains.
                var cfg = WorkflowJson.ParseMergeConfig(n.ConfigJson);
                if (cfg is null) errors.Add($"{label}: Merge config is not valid JSON.");
                else if (cfg.InputGainsDb is { } gains)
                {
                    if (gains.Count > inputs.Count)
                        errors.Add($"{label}: {gains.Count} gains given for {inputs.Count} inputs.");
                    if (gains.Any(g => double.IsNaN(g) || g < MinGainDb || g > MaxGainDb))
                        errors.Add($"{label}: input gains must be between {MinGainDb} and {MaxGainDb} dB.");
                }

                // V8: keeps on a Merge are a subset of ["Mix"].
                if ((n.KeptOutputs ?? new()).Any(k => k != NodeTypes.MergeOutputName))
                    errors.Add($"{label}: a Merge node can only keep '{NodeTypes.MergeOutputName}'.");
            }
        }

        // V2: DAG (Kahn's algorithm over edges to existing nodes).
        if (HasCycle(nodes, byId)) errors.Add("The workflow graph contains a cycle.");

        return errors;
    }

    private static bool HasCycle(IReadOnlyList<WorkflowNodeDefinition> nodes, Dictionary<Guid, WorkflowNodeDefinition> byId)
    {
        var indegree = byId.Keys.ToDictionary(k => k, _ => 0);
        var children = byId.Keys.ToDictionary(k => k, _ => new List<Guid>());
        foreach (var n in byId.Values)
            foreach (var src in (n.Inputs ?? new()).Select(i => i.SourceNodeId).Distinct())
                if (byId.ContainsKey(src)) { indegree[n.Id]++; children[src].Add(n.Id); }

        var queue = new Queue<Guid>(indegree.Where(kv => kv.Value == 0).Select(kv => kv.Key));
        var visited = 0;
        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            visited++;
            foreach (var c in children[id])
                if (--indegree[c] == 0) queue.Enqueue(c);
        }
        return visited != byId.Count;
    }

    /// <summary>Nodes that consume at least one output of <paramref name="nodeId"/>.</summary>
    public static IEnumerable<WorkflowNodeDefinition> Dependents(IEnumerable<WorkflowNodeDefinition> nodes, Guid nodeId) =>
        nodes.Where(n => n.Inputs.Any(i => i.SourceNodeId == nodeId));

    /// <summary>True when any node takes <c>(nodeId, outputName)</c> as an input.</summary>
    public static bool IsConsumed(IEnumerable<WorkflowNodeDefinition> nodes, Guid nodeId, string outputName) =>
        nodes.Any(n => n.Inputs.Any(i => i.SourceNodeId == nodeId && i.SourceOutputName == outputName));

    public static bool HasExplicitKeeps(IEnumerable<WorkflowNodeDefinition> nodes) =>
        nodes.Any(n => n.KeptOutputs is { Count: > 0 });
}
