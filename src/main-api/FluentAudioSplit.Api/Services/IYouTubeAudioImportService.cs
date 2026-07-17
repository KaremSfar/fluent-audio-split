using FluentAudioSplit.Domain.Entities;

namespace FluentAudioSplit.Api.Services;

public interface IYouTubeAudioImportService
{
    Task<FileRecord> ImportAsync(string userId, string url, CancellationToken ct = default);
}
