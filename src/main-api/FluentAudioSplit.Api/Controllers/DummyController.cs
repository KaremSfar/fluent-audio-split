using FluentAudioSplit.Api.Messages;
using MassTransit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FluentAudioSplit.Api.Controllers;

[ApiController]
[Route("api/dummy")]
[Authorize]
public class DummyController : ControllerBase
{
    private readonly ISendEndpointProvider _sendEndpointProvider;
    private readonly ILogger<DummyController> _logger;

    public DummyController(ISendEndpointProvider sendEndpointProvider, ILogger<DummyController> logger)
    {
        _sendEndpointProvider = sendEndpointProvider;
        _logger = logger;
    }

    [HttpPost("hello")]
    public async Task<IActionResult> Hello()
    {
        var endpoint = await _sendEndpointProvider.GetSendEndpoint(new Uri("queue:hello-world"));

        var command = new HelloWorldCommand { Message = "Hello World from C# API!" };
        await endpoint.Send(command);

        _logger.LogInformation("Published HelloWorldCommand to queue:hello-world");

        return Ok(new { message = "Task published" });
    }
}
