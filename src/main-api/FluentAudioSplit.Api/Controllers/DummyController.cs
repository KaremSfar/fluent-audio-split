using FluentAudioSplit.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FluentAudioSplit.Api.Controllers;

[ApiController]
[Route("api/dummy")]
[Authorize]
public class DummyController : ControllerBase
{
    private readonly IRabbitMqPublisher _publisher;

    public DummyController(IRabbitMqPublisher publisher)
    {
        _publisher = publisher;
    }

    [HttpPost("hello")]
    public async Task<IActionResult> Hello()
    {
        var taskId = await _publisher.PublishCeleryTaskAsync(
            "audio.hello_world",
            "Hello World from C# API!");

        return Ok(new { message = "Task published", taskId });
    }
}
