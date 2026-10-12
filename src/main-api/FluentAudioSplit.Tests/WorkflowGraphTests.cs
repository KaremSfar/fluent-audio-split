using FluentAudioSplit.Domain.Models;

namespace FluentAudioSplit.Tests;

public class WorkflowGraphTests
{
    private static string Cfg(string json) => json;

    [Fact]
    public void Valid_split_merge_graph_has_no_errors()
    {
        var a = Nodes.Split(0);
        var b = Nodes.Split(1, null, (a.Id, "Vocals"));
        var m = Nodes.Merge(2, "{\"inputGainsDb\":[0,-3]}", (b.Id, "Vocals"), (a.Id, "Bass"));
        Assert.Empty(WorkflowGraph.Validate(new[] { a, b, m }));
    }

    [Fact]
    public void V1_duplicate_and_empty_ids_fail()
    {
        var a = Nodes.Split(0);
        var dup = Nodes.Split(1, a.Id);
        Assert.Contains(WorkflowGraph.Validate(new[] { a, dup }), e => e.Contains("duplicate"));
        var empty = Nodes.Split(0, Guid.Empty);
        Assert.Contains(WorkflowGraph.Validate(new[] { empty }), e => e.Contains("non-empty"));
    }

    [Fact]
    public void V2_cycle_is_detected()
    {
        var a = Nodes.Split(0);
        var b = Nodes.Split(1, null, (a.Id, "Vocals"));
        a = a with { Inputs = new() { new NodeInputDefinition(b.Id, "Vocals") } };
        Assert.Contains(WorkflowGraph.Validate(new[] { a, b }), e => e.Contains("cycle"));
    }

    [Fact]
    public void V2_self_loop_is_a_cycle()
    {
        var a = Nodes.Split(0);
        a = a with { Inputs = new() { new NodeInputDefinition(a.Id, "Vocals") } };
        Assert.Contains(WorkflowGraph.Validate(new[] { a }), e => e.Contains("cycle"));
    }

    [Fact]
    public void V3_split_with_two_inputs_fails_but_zero_or_one_pass()
    {
        var a = Nodes.Split(0);
        var b = Nodes.Split(1);
        var two = Nodes.Split(2, null, (a.Id, "Vocals"), (b.Id, "Vocals"));
        Assert.Contains(WorkflowGraph.Validate(new[] { a, b, two }), e => e.Contains("at most 1 input"));
        var one = Nodes.Split(2, null, (a.Id, "Vocals"));
        Assert.Empty(WorkflowGraph.Validate(new[] { a, b, one }));
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, false)]
    [InlineData(2, true)]
    [InlineData(8, true)]
    [InlineData(9, false)]
    public void V4_merge_input_count(int count, bool ok)
    {
        var sources = Enumerable.Range(0, Math.Max(count, 1)).Select(i => Nodes.Split(i)).ToList();
        var inputs = sources.Take(count).Select(s => (s.Id, "Vocals")).ToArray();
        var merge = Nodes.Merge(100, null, inputs);
        var errors = WorkflowGraph.Validate(sources.Append(merge).ToList());
        Assert.Equal(ok, errors.Count == 0);
        if (!ok) Assert.Contains(errors, e => e.Contains("Merge node needs"));
    }

    [Fact]
    public void V5_dangling_input_empty_name_and_bad_merge_output_fail()
    {
        var a = Nodes.Split(0);
        var dangling = Nodes.Split(1, null, (Guid.NewGuid(), "Vocals"));
        Assert.Contains(WorkflowGraph.Validate(new[] { a, dangling }), e => e.Contains("missing node"));

        var emptyName = Nodes.Split(1, null, (a.Id, " "));
        Assert.Contains(WorkflowGraph.Validate(new[] { a, emptyName }), e => e.Contains("empty output name"));

        var b = Nodes.Split(1);
        var m = Nodes.Merge(2, null, (a.Id, "Vocals"), (b.Id, "Vocals"));
        var fromMerge = Nodes.Split(3, null, (m.Id, "Vocals"));
        Assert.Contains(WorkflowGraph.Validate(new[] { a, b, m, fromMerge }), e => e.Contains("only outputs 'Mix'"));

        var okFromMerge = Nodes.Split(3, null, (m.Id, "Mix"));
        Assert.Empty(WorkflowGraph.Validate(new[] { a, b, m, okFromMerge }));
    }

    [Fact]
    public void V6_duplicate_merge_inputs_fail()
    {
        var a = Nodes.Split(0);
        var m = Nodes.Merge(1, null, (a.Id, "Vocals"), (a.Id, "Vocals"));
        Assert.Contains(WorkflowGraph.Validate(new[] { a, m }), e => e.Contains("more than once"));
        var ok = Nodes.Merge(1, null, (a.Id, "Vocals"), (a.Id, "Bass"));
        Assert.Empty(WorkflowGraph.Validate(new[] { a, ok }));
    }

    [Theory]
    [InlineData("{\"inputGainsDb\":[0,-3]}", true)]
    [InlineData("{\"inputGainsDb\":[0]}", true)]
    [InlineData("{\"inputGainsDb\":[0,0,0]}", false)]
    [InlineData("{\"inputGainsDb\":[0,13]}", false)]
    [InlineData("{\"inputGainsDb\":[-61,0]}", false)]
    [InlineData("{\"inputGainsDb\":[12,-60]}", true)]
    [InlineData("not json", false)]
    public void V7_gains(string config, bool ok)
    {
        var a = Nodes.Split(0);
        var m = Nodes.Merge(1, config, (a.Id, "Vocals"), (a.Id, "Bass"));
        Assert.Equal(ok, WorkflowGraph.Validate(new[] { a, m }).Count == 0);
    }

    [Fact]
    public void V8_merge_keeps_only_Mix()
    {
        var a = Nodes.Split(0);
        var m = Nodes.Merge(1, null, (a.Id, "Vocals"), (a.Id, "Bass"));
        Assert.Empty(WorkflowGraph.Validate(new[] { a, m with { KeptOutputs = new() { "Mix" } } }));
        Assert.Contains(WorkflowGraph.Validate(new[] { a, m with { KeptOutputs = new() { "Vocals" } } }), e => e.Contains("can only keep"));
    }

    [Fact]
    public void V9_unknown_node_type_fails()
    {
        var a = Nodes.Split(0) with { NodeType = "Keep" };
        Assert.Contains(WorkflowGraph.Validate(new[] { a }), e => e.Contains("unknown node type"));
    }

    [Fact]
    public void Dependents_IsConsumed_HasExplicitKeeps()
    {
        var a = Nodes.Split(0);
        var b = Nodes.Split(1, null, (a.Id, "Vocals"));
        var m = Nodes.Merge(2, null, (a.Id, "Vocals"), (b.Id, "Drums"));
        var all = new[] { a, b, m };

        Assert.Equal(new[] { b.Id, m.Id }, WorkflowGraph.Dependents(all, a.Id).Select(n => n.Id).ToArray());
        Assert.Empty(WorkflowGraph.Dependents(all, m.Id));
        Assert.True(WorkflowGraph.IsConsumed(all, a.Id, "Vocals"));
        Assert.False(WorkflowGraph.IsConsumed(all, a.Id, "Bass"));
        Assert.True(WorkflowGraph.IsConsumed(all, b.Id, "Drums"));
        Assert.False(WorkflowGraph.IsConsumed(all, b.Id, "Vocals"));

        Assert.False(WorkflowGraph.HasExplicitKeeps(all));
        Assert.True(WorkflowGraph.HasExplicitKeeps(new[] { a, b with { KeptOutputs = new() { "Vocals" } } }));
    }

    [Fact]
    public void Json_roundtrip_is_camelCase()
    {
        var a = Nodes.Split(0, null) with { KeptOutputs = new() { "Drums" } };
        var json = WorkflowJson.Serialize(new[] { a });
        Assert.Contains("\"keptOutputs\"", json);
        Assert.Contains("\"inputs\"", json);
        Assert.DoesNotContain("isRoot", json);
        var back = WorkflowJson.DeserializeNodes(json);
        Assert.Equal(a.Id, back[0].Id);
        Assert.Equal(new[] { "Drums" }, back[0].KeptOutputs);
    }
}
