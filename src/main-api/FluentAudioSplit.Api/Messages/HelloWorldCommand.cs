namespace FluentAudioSplit.Api.Messages;

public record HelloWorldCommand
{
    public string Message { get; init; } = string.Empty;
}
