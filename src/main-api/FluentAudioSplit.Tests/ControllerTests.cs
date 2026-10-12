using System.Security.Claims;
using FluentAudioSplit.Api.Controllers;
using FluentAudioSplit.Api.Dtos;
using FluentAudioSplit.Domain.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

namespace FluentAudioSplit.Tests;

public class ControllerTests
{
    private static T WithUser<T>(T c, string userId) where T : ControllerBase
    {
        c.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId) }, "test"))
            }
        };
        return c;
    }

    [Fact]
    public async Task Results_get_returns_404_for_another_users_execution_and_200_for_owner()
    {
        using var h = new Harness();
        var a = Nodes.Split(0);
        await h.SeedAsync(new[] { a });

        var other = WithUser(new ExecutionResultsController(h.Db, h.Results), "someone-else");
        Assert.IsType<NotFoundResult>((await other.Get(h.ExecutionId, default)).Result);
        Assert.IsType<NotFoundResult>(await other.RemoveTrack(h.ExecutionId, Guid.NewGuid(), default));

        var owner = WithUser(new ExecutionResultsController(h.Db, h.Results), h.UserId());
        var ok = Assert.IsType<OkObjectResult>((await owner.Get(h.ExecutionId, default)).Result);
        var dto = Assert.IsType<ExecutionResultsDto>(ok.Value);
        Assert.Equal("Default", dto.KeepMode);
    }

    [Fact]
    public async Task Results_add_track_status_codes()
    {
        using var h = new Harness();
        var a = Nodes.Split(0) with { KeptOutputs = new() { "Drums" } };
        await h.SeedAsync(new[] { a });
        await using (var db = h.Db.CreateDbContext())
            await h.Results.SeedKeptAsync(db, db.WorkflowExecutions.First(), h.Defs, default);
        await h.CompleteAsync(await h.AddRunningAsync(a), "Drums", "Vocals");
        var c = WithUser(new ExecutionResultsController(h.Db, h.Results), h.UserId());

        Assert.Equal(409, ((ObjectResult)(await c.AddTrack(h.ExecutionId, new AddResultTrackRequest(a.Id, "Drums"), default)).Result!).StatusCode);
        Assert.Equal(400, ((ObjectResult)(await c.AddTrack(h.ExecutionId, new AddResultTrackRequest(a.Id, "Nope"), default)).Result!).StatusCode);
        var created = Assert.IsType<CreatedResult>((await c.AddTrack(h.ExecutionId, new AddResultTrackRequest(a.Id, "Vocals"), default)).Result);
        var track = Assert.IsType<ResultTrackDto>(created.Value);
        Assert.Equal("Manual", track.Origin);
        Assert.IsType<NoContentResult>(await c.RemoveTrack(h.ExecutionId, track.Id, default));
    }

    [Fact]
    public async Task Workflow_create_validates_and_keeps_client_node_ids()
    {
        using var h = new Harness();
        await h.SeedAsync(Array.Empty<WorkflowNodeDefinition>());
        var wc = WithUser(new WorkflowsController(h.Db, h.NewDispatcher(), h.Results, NullLogger<WorkflowsController>.Instance), h.UserId());

        var a = Guid.NewGuid();
        var m = Guid.NewGuid();
        var bad = new CreateWorkflowRequest("w", new()
        {
            new(a, 0, NodeTypes.AudioSeparation, "{}", new(), new()),
            new(m, 1, NodeTypes.Merge, "{}", new() { new(a, "Vocals") }, new()),   // only 1 input
        });
        var res = await wc.Create(bad, default);
        var objResult = Assert.IsAssignableFrom<ObjectResult>(res.Result);
        var vpd = Assert.IsType<ValidationProblemDetails>(objResult.Value);
        Assert.Equal(400, vpd.Status);
        Assert.NotEmpty(vpd.Errors["nodes"]);

        var good = bad with
        {
            Nodes = new()
            {
                new(a, 0, NodeTypes.AudioSeparation, "{}", new(), new() { "Drums" }),
                new(m, 1, NodeTypes.Merge, "{}", new() { new(a, "Vocals"), new(a, "Bass") }, new() { "Mix" }),
            }
        };
        var created = Assert.IsType<CreatedAtActionResult>((await wc.Create(good, default)).Result);
        var wf = Assert.IsType<WorkflowDto>(created.Value);
        Assert.Equal(new[] { a, m }, wf.Nodes.Select(n => n.Id).ToArray());
        Assert.Equal(a, wf.Nodes[1].Inputs[0].SourceNodeId);
        Assert.Equal(new[] { "Mix" }, wf.Nodes[1].KeptOutputs);
    }
}
