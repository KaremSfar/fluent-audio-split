namespace FluentAudioSplit.Api.Services;

public sealed class YouTubeAudioImportOptions
{
    public const string SectionName = "YouTubeAudioImport";

    public string DownloaderPath { get; init; } = "yt-dlp";
    public string JavaScriptRuntimePath { get; init; } = "deno";
    public string ImpersonateClient { get; init; } = "chrome";
    public string CookiesFilePath { get; init; } = string.Empty;
    public string FfmpegPath { get; init; } = string.Empty;
    public string TemporaryDirectory { get; init; } = Path.Combine(Path.GetTempPath(), "fluent-audio-split-imports");
    public int TimeoutSeconds { get; init; } = 300;
    public long MaximumFileSizeBytes { get; init; } = 1_073_741_824;
}
