namespace FluentAudioSplit.Api.Services;

public sealed class YouTubeAudioImportException : Exception
{
    public YouTubeAudioImportException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}
