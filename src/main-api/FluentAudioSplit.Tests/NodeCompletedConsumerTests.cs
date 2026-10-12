using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Tests;

public class NodeCompletedConsumerTests
{
    private static async Task<List<NodeExecution>> RowsAsync(Harness h)
    {
        await using var db = h.Db.CreateDbContext();
        return await db.NodeExecutions.Where(n => n.WorkflowExecutionId == h.ExecutionId).ToListAsync();
    }

    [Fact]
    public async Task Split_to_split_chaining_resolves_the_named_output()
    {
        using var h = new Harness();
        var a = Nodes.Split(0);
        var b = Nodes.Split(1, null, (a.Id, "Vocals"));
        await h.SeedAsync(new[] { a, b });

        var neA = await h.AddRunningAsync(a);
        await h.CompleteAsync(neA, "Vocals", "Other");

        var cmd = Assert.Single(h.Sender.Commands);
        Assert.Equal(NodeTypes.AudioSeparation, cmd.NodeType);
        Assert.Contains("vocals_", cmd.InputArtifactPath);
        Assert.Empty(cmd.InputArtifacts);
        Assert.Null(cmd.TrimStartSeconds);

        var rows = await RowsAsync(h);
        var rowB = Assert.Single(rows, r => r.WorkflowNodeId == b.Id);
        Assert.Equal(NodeExecutionStatus.Queued, rowB.Status);
        Assert.Equal(cmd.InputArtifactPath, rowB.InputArtifactPath);
    }

    [Fact]
    public async Task Missing_output_fails_the_dependent_and_does_not_fall_back_to_first_output()
    {
        using var h = new Harness();
        var a = Nodes.Split(0);
        var b = Nodes.Split(1, null, (a.Id, "Bass"));
        await h.SeedAsync(new[] { a, b });

        await h.CompleteAsync(await h.AddRunningAsync(a), "Vocals", "Other");

        Assert.Empty(h.Sender.Commands);
        var rowB = Assert.Single(await RowsAsync(h), r => r.WorkflowNodeId == b.Id);
        Assert.Equal(NodeExecutionStatus.Failed, rowB.Status);
        Assert.Contains("'Bass'", rowB.ErrorMessage);

        // Both nodes are settled -> the execution is terminal (PartiallyFailed), not stuck Running.
        await using var db = h.Db.CreateDbContext();
        Assert.Equal(WorkflowExecutionStatus.PartiallyFailed, (await db.WorkflowExecutions.FindAsync(h.ExecutionId))!.Status);
    }

    [Fact]
    public async Task Merge_waits_for_all_parents_then_sends_ordered_inputs_with_gains()
    {
        using var h = new Harness();
        var a = Nodes.Split(0);
        var b = Nodes.Split(1);
        var m = Nodes.Merge(2, "{\"inputGainsDb\":[0,-3],\"levelMode\":\"preventClipping\"}", (a.Id, "Vocals"), (b.Id, "Bass"));
        await h.SeedAsync(new[] { a, b, m });

        var neA = await h.AddRunningAsync(a);
        var neB = await h.AddRunningAsync(b);

        await h.CompleteAsync(neB, "Bass");          // second parent first: order must follow definition
        Assert.Empty(h.Sender.Commands);
        Assert.DoesNotContain(await RowsAsync(h), r => r.WorkflowNodeId == m.Id);

        await h.CompleteAsync(neA, "Vocals");
        var cmd = Assert.Single(h.Sender.Commands);
        Assert.Equal(NodeTypes.Merge, cmd.NodeType);
        Assert.Equal("", cmd.InputArtifactPath);
        Assert.Equal(new[] { "Vocals", "Bass" }, cmd.InputArtifacts.Select(i => i.Label).ToArray());
        Assert.Equal(new[] { 0.0, -3.0 }, cmd.InputArtifacts.Select(i => i.GainDb).ToArray());
        Assert.Contains("vocals_", cmd.InputArtifacts[0].Path);
        Assert.Contains("bass_", cmd.InputArtifacts[1].Path);

        var rowM = Assert.Single(await RowsAsync(h), r => r.WorkflowNodeId == m.Id);
        Assert.Equal(NodeTypes.Merge, rowM.NodeType);
        Assert.NotNull(rowM.InputArtifactsJson);
        Assert.Contains("\"gainDb\":-3", rowM.InputArtifactsJson);
    }

    [Fact]
    public async Task Duplicate_completion_event_does_not_dispatch_twice()
    {
        using var h = new Harness();
        var a = Nodes.Split(0);
        var b = Nodes.Split(1, null, (a.Id, "Vocals"));
        await h.SeedAsync(new[] { a, b });
        var neA = await h.AddRunningAsync(a);

        await h.CompleteAsync(neA, "Vocals");
        await h.CompleteAsync(neA, "Vocals");

        Assert.Single(h.Sender.Commands);
        Assert.Single(await RowsAsync(h), r => r.WorkflowNodeId == b.Id);
    }

    [Fact]
    public async Task Concurrent_completion_of_two_merge_parents_creates_exactly_one_merge_execution()
    {
        // Repeat to give the race a real chance to interleave.
        for (var round = 0; round < 15; round++)
        {
            using var h = new Harness();
            var a = Nodes.Split(0);
            var b = Nodes.Split(1);
            var m = Nodes.Merge(2, null, (a.Id, "Vocals"), (b.Id, "Bass"));
            await h.SeedAsync(new[] { a, b, m });
            var neA = await h.AddRunningAsync(a);
            var neB = await h.AddRunningAsync(b);

            // Two independent consumer instances (own DbContexts), released together.
            var gate = new TaskCompletionSource();
            Task Run(NodeExecution ne, string output) => Task.Run(async () =>
            {
                await gate.Task;
                await h.CompleteAsync(ne, output);
            });
            var t1 = Run(neA, "Vocals");
            var t2 = Run(neB, "Bass");
            gate.SetResult();
            await Task.WhenAll(t1, t2);

            var mergeRows = (await RowsAsync(h)).Where(r => r.WorkflowNodeId == m.Id).ToList();
            Assert.Single(mergeRows);
            Assert.Single(h.Sender.Commands, c => c.NodeType == NodeTypes.Merge);
        }
    }

    [Fact]
    public async Task Dispatcher_loses_race_gracefully_when_row_already_exists()
    {
        using var h = new Harness();
        var a = Nodes.Split(0);
        await h.SeedAsync(new[] { a });
        await using var db = h.Db.CreateDbContext();
        var exec = await db.WorkflowExecutions.FirstAsync();
        var d = h.NewDispatcher();

        Assert.NotNull(await d.DispatchAsync(db, exec, h.Defs, a, 1, CancellationToken.None));
        Assert.Null(await d.DispatchAsync(db, exec, h.Defs, a, 1, CancellationToken.None));
        Assert.Single(h.Sender.Commands);
        var root = h.Sender.Commands[0];
        Assert.Equal("uploads/u/song.mp3", root.InputArtifactPath);
    }

    [Fact]
    public async Task Retry_attempt_resolves_inputs_from_latest_completed_source_attempt()
    {
        using var h = new Harness();
        var a = Nodes.Split(0);
        var b = Nodes.Split(1, null, (a.Id, "Vocals"));
        await h.SeedAsync(new[] { a, b });
        await h.CompleteAsync(await h.AddRunningAsync(a), "Vocals");

        await using var db = h.Db.CreateDbContext();
        var exec = await db.WorkflowExecutions.FirstAsync();
        var retry = await h.NewDispatcher().DispatchAsync(db, exec, h.Defs, b, 2, CancellationToken.None);
        Assert.NotNull(retry);
        Assert.Equal(2, retry!.Attempt);
        Assert.Equal(2, h.Sender.Commands.Count);
        Assert.Equal(h.Sender.Commands[0].InputArtifactPath, h.Sender.Commands[1].InputArtifactPath);
    }
}
