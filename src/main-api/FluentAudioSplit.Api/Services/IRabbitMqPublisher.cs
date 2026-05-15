namespace FluentAudioSplit.Api.Services;

public interface IRabbitMqPublisher
{
    Task<string> PublishCeleryTaskAsync(string taskName, string message);
}
