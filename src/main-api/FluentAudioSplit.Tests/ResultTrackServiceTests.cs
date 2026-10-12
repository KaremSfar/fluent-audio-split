using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Domain.Models;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Tests;

public class ResultTrackServiceTests
{

    private static Task<WorkflowExecution> LoadAsync(Harness h, FluentAudioSplit.Infrastructure.Persistence.ApplicationDbContext db) =>
        db.WorkflowExecutions
            .Include(e => e.WorkflowVersion).ThenInclude(v => v.Workflow)
            .Include(e => e.InputFileRecord)
            .FirstAsync(e => e.Id == h.ExecutionId);

    [Fact]
    public async Task Explicit_keeps_are_seeded_in_definition_order_and_pending_until_complete()
    {
        using var h = new Harness();
        var a = Nodes.Split(0) with { KeptOutputs = new() { "Drums", "Bass" } };
        var b = Nodes.Split(1, null, (a.Id, "Vocals")) with { KeptOutputs = new() { "Other" } };
        await h.SeedAsync(new[] { a, b });

        await using var db = h.Db.CreateDbContext();
        var exec = await LoadAsync(h, db);
        await h.Results.SeedKeptAsync(db, exec, h.Defs, default);

        var dto = await h.Results.BuildResultsAsync(db, exec, default);
        Assert.Equal("Explicit", dto.KeepMode);
        Assert.Equal(new[] { "Drums", "Bass", "Other" }, dto.Tracks.Select(t => t.OutputName).ToArray());
        Assert.All(dto.Tracks, t => { Assert.Equal("Kept", t.Origin); Assert.Equal("Pending", t.State); });
    }

    [Fact]
    public async Task Default_mode_inserts_only_unconsumed_outputs_on_completion()
    {
        using var h = new Harness();
        var a = Nodes.Split(0);
        var b = Nodes.Split(1, null, (a.Id, "Vocals"));
        await h.SeedAsync(new[] { a, b });

        await h.CompleteAsync(await h.AddRunningAsync(a), "Vocals", "Drums", "Bass");
        NodeExecution chainedB;
        await using (var dbb = h.Db.CreateDbContext())
            chainedB = await dbb.NodeExecutions.FirstAsync(n => n.WorkflowNodeId == b.Id);
        await h.CompleteAsync(chainedB, "Lead", "Backing");

        await using var db = h.Db.CreateDbContext();
        var exec = await LoadAsync(h, db);
        var dto = await h.Results.BuildResultsAsync(db, exec, default);
        Assert.Equal("Default", dto.KeepMode);
        var names = dto.Tracks.Select(t => t.OutputName).OrderBy(x => x).ToArray();
        Assert.Equal(new[] { "Backing", "Bass", "Drums", "Lead" }, names);   // Vocals is consumed
        Assert.All(dto.Tracks, t => { Assert.Equal("Default", t.Origin); Assert.Equal("Ready", t.State); Assert.NotNull(t.ArtifactPath); });
        Assert.DoesNotContain(dto.Available, x => x.OutputName != "Vocals");
        Assert.Contains(dto.Available, x => x.OutputName == "Vocals");
    }

    [Fact]
    public async Task Explicit_mode_does_not_add_default_rows_on_completion()
    {
        using var h = new Harness();
        var a = Nodes.Split(0) with { KeptOutputs = new() { "Drums" } };
        await h.SeedAsync(new[] { a });
        await using (var db0 = h.Db.CreateDbContext())
            await h.Results.SeedKeptAsync(db0, await LoadAsync(h, db0), h.Defs, default);

        await h.CompleteAsync(await h.AddRunningAsync(a), "Vocals", "Drums");

        await using var db = h.Db.CreateDbContext();
        var dto = await h.Results.BuildResultsAsync(db, await LoadAsync(h, db), default);
        var t = Assert.Single(dto.Tracks);
        Assert.Equal("Drums", t.OutputName);
        Assert.Equal("Ready", t.State);
        Assert.Equal("Vocals", Assert.Single(dto.Available).OutputName);
    }

    [Fact]
    public async Task Retry_updates_the_resolved_path_and_state_follows_latest_attempt()
    {
        using var h = new Harness();
        var a = Nodes.Split(0) with { KeptOutputs = new() { "Drums" } };
        await h.SeedAsync(new[] { a });
        await using (var db0 = h.Db.CreateDbContext())
            await h.Results.SeedKeptAsync(db0, await LoadAsync(h, db0), h.Defs, default);

        // attempt 1 failed
        Guid failedId;
        await using (var dbf = h.Db.CreateDbContext())
        {
            var ne = new NodeExecution
            {
                WorkflowExecutionId = h.ExecutionId, WorkflowNodeId = a.Id, Attempt = 1,
                Status = NodeExecutionStatus.Failed, ErrorMessage = "CUDA OOM",
            };
            dbf.NodeExecutions.Add(ne);
            await dbf.SaveChangesAsync();
            failedId = ne.Id;
        }
        await using (var db = h.Db.CreateDbContext())
        {
            var t = Assert.Single((await h.Results.BuildResultsAsync(db, await LoadAsync(h, db), default)).Tracks);
            Assert.Equal("Failed", t.State);
            Assert.Equal("CUDA OOM", t.ErrorMessage);
        }

        // attempt 2 completes
        var retry = await h.AddRunningAsync(a, attempt: 2);
        await h.CompleteAsync(retry, "Drums");
        await using (var db = h.Db.CreateDbContext())
        {
            var t = Assert.Single((await h.Results.BuildResultsAsync(db, await LoadAsync(h, db), default)).Tracks);
            Assert.Equal("Ready", t.State);
            Assert.Contains(retry.Id.ToString()[..5], t.ArtifactPath);
        }
    }

    [Fact]
    public async Task State_mapping_missing_cancelled_pending_and_merge_display_name()
    {
        using var h = new Harness();
        var a = Nodes.Split(0) with { KeptOutputs = new() { "Drums", "Bass" } };
        var b = Nodes.Split(1) with { KeptOutputs = new() { "Drums" } };
        var m = Nodes.Merge(2, "{\"label\":\"Backing\"}", (a.Id, "Drums"), (b.Id, "Drums")) with { KeptOutputs = new() { "Mix" } };
        var m2 = Nodes.Merge(3, null, (a.Id, "Drums"), (a.Id, "Bass")) with { KeptOutputs = new() { "Mix" } };
        await h.SeedAsync(new[] { a, b, m, m2 });
        await using (var db0 = h.Db.CreateDbContext())
            await h.Results.SeedKeptAsync(db0, await LoadAsync(h, db0), h.Defs, default);

        // a completes without "Bass" (Missing); b cancelled; m pending (no row)
        await using (var dbc = h.Db.CreateDbContext())
        {
            dbc.NodeExecutions.Add(new NodeExecution { WorkflowExecutionId = h.ExecutionId, WorkflowNodeId = b.Id, Status = NodeExecutionStatus.Cancelled });
            await dbc.SaveChangesAsync();
        }
        // complete a directly through the service path (consumer would chain merges; fine, they are Queued then)
        await h.CompleteAsync(await h.AddRunningAsync(a), "Drums");

        await using var db = h.Db.CreateDbContext();
        var dto = await h.Results.BuildResultsAsync(db, await LoadAsync(h, db), default);
        TrackByKey(dto, a.Id, "Drums", "Ready");
        TrackByKey(dto, a.Id, "Bass", "Missing");
        var cancelled = TrackByKey(dto, b.Id, "Drums", "Cancelled");
        Assert.Equal("Drums (Node 1)", dto.Tracks.First(t => t.WorkflowNodeId == a.Id && t.OutputName == "Drums").DisplayName);
        Assert.Equal("Drums (Node 2)", cancelled.DisplayName);
        Assert.Equal("Bass", dto.Tracks.First(t => t.OutputName == "Bass").DisplayName);
        Assert.Equal("Backing", TrackByKey(dto, m.Id, "Mix", "Pending").DisplayName);
        // m2 needs "Bass" from a, which a did not produce -> the dependent failed (no first-output fallback).
        var mt = TrackByKey(dto, m2.Id, "Mix", "Failed");
        Assert.Contains("'Bass'", mt.ErrorMessage);
        Assert.Equal("Drums + Bass", mt.DisplayName);
        Assert.Equal("Merge", mt.NodeType);
        Assert.Null(mt.ModelName);
    }

    private static FluentAudioSplit.Api.Dtos.ResultTrackDto TrackByKey(
        FluentAudioSplit.Api.Dtos.ExecutionResultsDto dto, Guid node, string output, string state)
    {
        var t = Assert.Single(dto.Tracks, x => x.WorkflowNodeId == node && x.OutputName == output);
        Assert.Equal(state, t.State);
        return t;
    }

    [Fact]
    public async Task Manual_add_conflict_not_an_output_and_remove()
    {
        using var h = new Harness();
        var a = Nodes.Split(0) with { KeptOutputs = new() { "Drums" } };
        await h.SeedAsync(new[] { a });
        await using (var db0 = h.Db.CreateDbContext())
            await h.Results.SeedKeptAsync(db0, await LoadAsync(h, db0), h.Defs, default);
        await h.CompleteAsync(await h.AddRunningAsync(a), "Drums", "Vocals");

        await using var db = h.Db.CreateDbContext();
        var exec = await LoadAsync(h, db);

        Assert.Equal(AddTrackOutcome.Conflict, await h.Results.AddManualAsync(db, exec, a.Id, "Drums", default));
        Assert.Equal(AddTrackOutcome.NotAnOutput, await h.Results.AddManualAsync(db, exec, a.Id, "Piano", default));
        Assert.Equal(AddTrackOutcome.NotAnOutput, await h.Results.AddManualAsync(db, exec, Guid.NewGuid(), "Drums", default));
        Assert.Equal(AddTrackOutcome.Created, await h.Results.AddManualAsync(db, exec, a.Id, "Vocals", default));

        var dto = await h.Results.BuildResultsAsync(db, exec, default);
        Assert.Equal(new[] { "Drums", "Vocals" }, dto.Tracks.Select(t => t.OutputName).ToArray());
        Assert.Equal("Manual", dto.Tracks[1].Origin);
        Assert.Empty(dto.Available);

        Assert.False(await h.Results.RemoveAsync(db, exec.Id, Guid.NewGuid(), default));
        Assert.True(await h.Results.RemoveAsync(db, exec.Id, dto.Tracks[1].Id, default));
        Assert.Single((await h.Results.BuildResultsAsync(db, exec, default)).Available);
    }

    [Fact]
    public async Task Execution_settles_as_Completed_when_every_node_completes()
    {
        using var h = new Harness();
        var a = Nodes.Split(0);
        var m = Nodes.Merge(1, null, (a.Id, "Vocals"), (a.Id, "Bass"));
        await h.SeedAsync(new[] { a, m });

        await h.CompleteAsync(await h.AddRunningAsync(a), "Vocals", "Bass");
        NodeExecution chained;
        await using (var dbb = h.Db.CreateDbContext())
            chained = await dbb.NodeExecutions.FirstAsync(n => n.WorkflowNodeId == m.Id);
        await h.CompleteAsync(chained, "Mix");

        await using var db = h.Db.CreateDbContext();
        var exec = await db.WorkflowExecutions.FirstAsync(e => e.Id == h.ExecutionId);
        Assert.Equal(WorkflowExecutionStatus.Completed, exec.Status);
    }
}
