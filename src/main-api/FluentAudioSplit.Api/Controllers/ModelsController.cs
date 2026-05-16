using FluentAudioSplit.Domain.Models;
using Microsoft.AspNetCore.Mvc;

namespace FluentAudioSplit.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ModelsController : ControllerBase
{
    [HttpGet]
    public ActionResult<Dictionary<string, string[]>> GetModels()
    {
        return Ok(StemDefinitions.ModelStems);
    }
}
