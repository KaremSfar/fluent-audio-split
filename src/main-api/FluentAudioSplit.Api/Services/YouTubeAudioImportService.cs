using System.Diagnostics;
using System.Security.Cryptography;
using FluentAudioSplit.Domain.Entities;
using FluentAudioSplit.Infrastructure.Persistence;
using FluentAudioSplit.Infrastructure.Storage;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FluentAudioSplit.Api.Services;

public sealed class YouTubeAudioImportService : IYouTubeAudioImportService
{
    private readonly IDbContextFactory<ApplicationDbContext> _dbFactory;
    private readonly IFileStorageProvider _storage;
    private readonly YouTubeAudioImportOptions _options;
    private readonly ILogger<YouTubeAudioImportService> _logger;

    public YouTubeAudioImportService(
        IDbContextFactory<ApplicationDbContext> dbFactory,
        IFileStorageProvider storage,
        IOptions<YouTubeAudioImportOptions> options,
        ILogger<YouTubeAudioImportService> logger)
    {
        _dbFactory = dbFactory;
        _storage = storage;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<FileRecord> ImportAsync(string userId, string url, CancellationToken ct = default)
    {
        var video = ParseVideoUrl(url);
        var workDirectory = Path.Combine(_options.TemporaryDirectory, Guid.NewGuid().ToString("N"));
        string? storedPath = null;

        try
        {
            Directory.CreateDirectory(workDirectory);
            await DownloadMp3Async(video.CanonicalUrl, workDirectory, ct);

            var downloadedFile = FindDownloadedFile(workDirectory);
            var fileInfo = new FileInfo(downloadedFile);
            if (fileInfo.Length == 0)
                throw new YouTubeAudioImportException("YouTube did not provide an audio file.");
            if (fileInfo.Length > _options.MaximumFileSizeBytes)
                throw new YouTubeAudioImportException("The imported audio file exceeds the configured size limit.");

            string contentHash;
            await using (var input = File.OpenRead(downloadedFile))
            {
                contentHash = Convert.ToHexString(await SHA256.HashDataAsync(input, ct)).ToLowerInvariant();
            }

            await using var db = await _dbFactory.CreateDbContextAsync(ct);
            var existing = await db.FileRecords
                .FirstOrDefaultAsync(file => file.UserId == userId && file.ContentHash == contentHash, ct);
            if (existing is not null)
                return existing;

            var fileId = Guid.NewGuid();
            var originalFileName = Path.GetFileName(downloadedFile);
            storedPath = $"uploads/{userId}/{fileId}/{originalFileName}";

            await using (var input = File.OpenRead(downloadedFile))
            {
                await _storage.WriteAsync(storedPath, input, ct);
            }

            var record = new FileRecord
            {
                Id = fileId,
                UserId = userId,
                OriginalFileName = originalFileName,
                StoragePath = storedPath,
                ContentType = "audio/mpeg",
                SizeBytes = fileInfo.Length,
                ContentHash = contentHash,
                CreatedAt = DateTime.UtcNow
            };

            db.FileRecords.Add(record);
            await db.SaveChangesAsync(ct);
            storedPath = null;
            return record;
        }
        catch (YouTubeAudioImportException)
        {
            throw;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Unable to import YouTube audio for user {UserId}", userId);
            throw new YouTubeAudioImportException("Unable to import audio from that YouTube video.", exception);
        }
        finally
        {
            if (storedPath is not null)
            {
                try
                {
                    await _storage.DeleteAsync(storedPath, CancellationToken.None);
                }
                catch (Exception cleanupException)
                {
                    _logger.LogWarning(cleanupException, "Unable to remove incomplete imported file {StoragePath}", storedPath);
                }
            }

            try
            {
                if (Directory.Exists(workDirectory))
                    Directory.Delete(workDirectory, recursive: true);
            }
            catch (Exception cleanupException)
            {
                _logger.LogWarning(cleanupException, "Unable to remove YouTube import work directory {WorkDirectory}", workDirectory);
            }
        }
    }

    private async Task DownloadMp3Async(string canonicalUrl, string workDirectory, CancellationToken ct)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(_options.TimeoutSeconds));
        using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = _options.DownloaderPath,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = workDirectory
            }
        };

        process.StartInfo.ArgumentList.Add("--no-playlist");
        process.StartInfo.ArgumentList.Add("--no-progress");
        process.StartInfo.ArgumentList.Add("--no-warnings");
        process.StartInfo.ArgumentList.Add("--ignore-config");
        process.StartInfo.ArgumentList.Add("--js-runtimes");
        process.StartInfo.ArgumentList.Add($"deno:{_options.JavaScriptRuntimePath}");
        if (!string.IsNullOrWhiteSpace(_options.CookiesFilePath))
        {
            var cookiesFile = new FileInfo(_options.CookiesFilePath);
            if (!cookiesFile.Exists || cookiesFile.Length == 0)
                throw new YouTubeAudioImportException("The server's YouTube authentication cookie file is unavailable.");

            process.StartInfo.ArgumentList.Add("--cookies");
            process.StartInfo.ArgumentList.Add(cookiesFile.FullName);
        }
        process.StartInfo.ArgumentList.Add("--extract-audio");
        process.StartInfo.ArgumentList.Add("--audio-format");
        process.StartInfo.ArgumentList.Add("mp3");
        if (!string.IsNullOrWhiteSpace(_options.FfmpegPath))
        {
            process.StartInfo.ArgumentList.Add("--ffmpeg-location");
            process.StartInfo.ArgumentList.Add(_options.FfmpegPath);
        }
        process.StartInfo.ArgumentList.Add("--max-filesize");
        process.StartInfo.ArgumentList.Add(_options.MaximumFileSizeBytes.ToString(System.Globalization.CultureInfo.InvariantCulture));
        process.StartInfo.ArgumentList.Add("--output");
        process.StartInfo.ArgumentList.Add(Path.Combine(workDirectory, "%(title)s.%(ext)s"));
        process.StartInfo.ArgumentList.Add(canonicalUrl);

        try
        {
            if (!process.Start())
                throw new YouTubeAudioImportException("Unable to start the YouTube audio downloader.");

            var standardOutput = process.StandardOutput.ReadToEndAsync();
            var standardError = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync(linkedCancellation.Token);

            var errorOutput = await standardError;
            if (process.ExitCode != 0)
            {
                _logger.LogWarning(
                    "yt-dlp failed with exit code {ExitCode}: {ErrorOutput}",
                    process.ExitCode,
                    Truncate(errorOutput, 4_000));
                throw new YouTubeAudioImportException("YouTube could not provide audio for that video.");
            }

            await standardOutput;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            StopProcess(process);
            throw;
        }
        catch (OperationCanceledException)
        {
            StopProcess(process);
            throw new YouTubeAudioImportException("The YouTube audio download timed out.");
        }
    }

    private static string FindDownloadedFile(string workDirectory)
    {
        var files = Directory.EnumerateFiles(workDirectory, "*.mp3", SearchOption.TopDirectoryOnly)
            .Where(path => new FileInfo(path).Length > 0)
            .ToArray();

        return files.Length switch
        {
            1 => files[0],
            0 => throw new YouTubeAudioImportException("YouTube did not produce an MP3 audio file."),
            _ => throw new YouTubeAudioImportException("YouTube produced an unexpected set of audio files.")
        };
    }

    private static YouTubeVideo ParseVideoUrl(string rawUrl)
    {
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var url)
            || url.Scheme is not ("http" or "https"))
        {
            throw new YouTubeAudioImportException("Enter a valid single-video YouTube URL.");
        }

        var host = url.Host.ToLowerInvariant();
        var pathParts = url.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        string? videoId = null;

        if (host == "youtu.be")
        {
            if (pathParts.Length == 1)
                videoId = pathParts[0];
        }
        else if (host is "youtube.com" or "www.youtube.com" or "m.youtube.com" or "music.youtube.com")
        {
            var query = QueryHelpers.ParseQuery(url.Query);
            if (query.ContainsKey("list"))
                throw new YouTubeAudioImportException("Playlist URLs are not supported. Paste a link to one video instead.");

            if (url.AbsolutePath.Equals("/watch", StringComparison.OrdinalIgnoreCase)
                && query.TryGetValue("v", out var values))
            {
                videoId = values.FirstOrDefault();
            }
            else if (pathParts.Length == 2
                && pathParts[0].Equals("shorts", StringComparison.OrdinalIgnoreCase)
                    || pathParts.Length == 2
                && pathParts[0].Equals("embed", StringComparison.OrdinalIgnoreCase)
                    || pathParts.Length == 2
                && pathParts[0].Equals("live", StringComparison.OrdinalIgnoreCase))
            {
                videoId = pathParts[1];
            }
        }

        if (videoId is null || !System.Text.RegularExpressions.Regex.IsMatch(videoId, "^[A-Za-z0-9_-]{11}$"))
            throw new YouTubeAudioImportException("Enter a valid single-video YouTube URL.");

        return new YouTubeVideo(videoId, $"https://www.youtube.com/watch?v={videoId}");
    }

    private static void StopProcess(Process process)
    {
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException)
        {
        }
    }

    private static string Truncate(string value, int maximumLength) =>
        value.Length <= maximumLength ? value : value[..maximumLength];

    private sealed record YouTubeVideo(string Id, string CanonicalUrl);
}
