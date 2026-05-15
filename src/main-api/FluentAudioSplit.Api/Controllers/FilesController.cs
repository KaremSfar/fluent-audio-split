using System.Security.Claims;
using FluentAudioSplit.Api.Dtos;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Infrastructure.Persistence;
using FluentAudioSplit.Infrastructure.Storage;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class FilesController : ControllerBase
{
    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly IFileStorageProvider _storage;
    private readonly ILogger<FilesController> _logger;

    public FilesController(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        IFileStorageProvider storage,
        ILogger<FilesController> logger)
    {
        _dbFactory = dbFactory;
        _storage = storage;
        _logger = logger;
    }

    [HttpPost("upload")]
    public async Task<ActionResult<FileRecordDto>> Upload(IFormFile file, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var fileId = Guid.NewGuid();
        var relativePath = $"uploads/{userId}/{fileId}/{file.FileName}";

        await using var stream = file.OpenReadStream();
        await _storage.WriteAsync(relativePath, stream, ct);

        var record = new FileRecord
        {
            Id = fileId,
            UserId = userId,
            OriginalFileName = file.FileName,
            StoragePath = relativePath,
            ContentType = file.ContentType,
            SizeBytes = file.Length,
            CreatedAt = DateTime.UtcNow
        };

        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        db.FileRecords.Add(record);
        await db.SaveChangesAsync(ct);

        return Ok(ToDto(record));
    }

    [HttpGet]
    public async Task<ActionResult<List<FileRecordDto>>> List(CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var records = await db.FileRecords
            .Where(f => f.UserId == userId)
            .OrderByDescending(f => f.CreatedAt)
            .ToListAsync(ct);

        return Ok(records.Select(ToDto).ToList());
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var record = await db.FileRecords.FirstOrDefaultAsync(f => f.Id == id && f.UserId == userId, ct);
        if (record is null) return NotFound();

        await _storage.DeleteAsync(record.StoragePath, ct);
        db.FileRecords.Remove(record);
        await db.SaveChangesAsync(ct);

        return NoContent();
    }

    [HttpGet("download")]
    public async Task<IActionResult> Download([FromQuery] string path, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var record = await db.FileRecords
            .FirstOrDefaultAsync(f => f.StoragePath == path && f.UserId == userId, ct);

        if (record is null)
        {
            var owned = await db.WorkflowExecutions
                .AnyAsync(we => we.UserId == userId && we.NodeExecutions.Any(ne => ne.OutputArtifactDir != null && path.StartsWith(ne.OutputArtifactDir)), ct);
            if (!owned) return NotFound();
        }

        if (!await _storage.ExistsAsync(path, ct)) return NotFound();

        var stream = await _storage.ReadAsync(path, ct);
        var contentType = record?.ContentType ?? "application/octet-stream";
        var fileName = record?.OriginalFileName ?? Path.GetFileName(path);
        return File(stream, contentType, fileName);
    }

    private static FileRecordDto ToDto(FileRecord r) =>
        new(r.Id, r.OriginalFileName, r.ContentType, r.SizeBytes, r.CreatedAt);
}
