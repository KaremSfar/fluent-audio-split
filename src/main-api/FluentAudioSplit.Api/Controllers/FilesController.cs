using System.Security.Claims;
using System.Security.Cryptography;
using FluentAudioSplit.Api.Dtos;
using FluentAudioSplit.Api.Services;
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
    private readonly IYouTubeAudioImportService _youTubeAudioImportService;
    private readonly ILogger<FilesController> _logger;

    public FilesController(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        IFileStorageProvider storage,
        IYouTubeAudioImportService youTubeAudioImportService,
        ILogger<FilesController> logger)
    {
        _dbFactory = dbFactory;
        _storage = storage;
        _youTubeAudioImportService = youTubeAudioImportService;
        _logger = logger;
    }

    [HttpPost("upload")]
    public async Task<ActionResult<FileRecordDto>> Upload(IFormFile file, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var fileId = Guid.NewGuid();
        var relativePath = $"uploads/{userId}/{fileId}/{file.FileName}";

        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();
        var contentHash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        buffer.Position = 0;
        await _storage.WriteAsync(relativePath, buffer, ct);

        var record = new FileRecord
        {
            Id = fileId,
            UserId = userId,
            OriginalFileName = file.FileName,
            StoragePath = relativePath,
            ContentType = file.ContentType,
            SizeBytes = file.Length,
            ContentHash = contentHash,
            CreatedAt = DateTime.UtcNow
        };

        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        db.FileRecords.Add(record);
        await db.SaveChangesAsync(ct);

        return Ok(ToDto(record));
    }

    [HttpPost("import-youtube")]
    public async Task<ActionResult<FileRecordDto>> ImportYouTube(
        ImportYouTubeAudioRequest request,
        CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;

        try
        {
            var record = await _youTubeAudioImportService.ImportAsync(userId, request.Url, ct);
            return Ok(ToDto(record));
        }
        catch (YouTubeAudioImportException exception)
        {
            return BadRequest(exception.Message);
        }
    }

    [HttpGet("by-hash/{hash}")]
    public async Task<ActionResult<FileRecordDto>> FindByHash(string hash, CancellationToken ct)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(hash, "^[a-f0-9]{64}$"))
            return BadRequest("Invalid hash format.");

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var record = await db.FileRecords
            .FirstOrDefaultAsync(f => f.UserId == userId && f.ContentHash == hash, ct);

        if (record is null) return NotFound();
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

    [HttpGet("{id:guid}/content")]
    public async Task<IActionResult> GetContent(Guid id, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        var record = await db.FileRecords
            .FirstOrDefaultAsync(file => file.Id == id && file.UserId == userId, ct);
        if (record is null || !await _storage.ExistsAsync(record.StoragePath, ct))
            return NotFound();

        var stream = await _storage.ReadAsync(record.StoragePath, ct);
        return File(stream, record.ContentType, record.OriginalFileName, enableRangeProcessing: true);
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
        new(r.Id, r.OriginalFileName, r.ContentType, r.SizeBytes, r.CreatedAt, r.ContentHash);
}
