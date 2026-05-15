using System.Text;
using System.Text.Json;
using RabbitMQ.Client;

namespace FluentAudioSplit.Api.Services;

public class RabbitMqPublisher : IRabbitMqPublisher
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<RabbitMqPublisher> _logger;

    public RabbitMqPublisher(IConfiguration configuration, ILogger<RabbitMqPublisher> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<string> PublishCeleryTaskAsync(string taskName, string message)
    {
        var taskId = Guid.NewGuid().ToString();

        var host = _configuration["RabbitMq:Host"] ?? "localhost";
        var username = _configuration["RabbitMq:Username"] ?? "guest";
        var password = _configuration["RabbitMq:Password"] ?? "guest";

        var factory = new ConnectionFactory
        {
            HostName = host,
            UserName = username,
            Password = password,
        };

        await using var connection = await factory.CreateConnectionAsync();
        await using var channel = await connection.CreateChannelAsync();

        await channel.QueueDeclareAsync(
            queue: "celery",
            durable: true,
            exclusive: false,
            autoDelete: false,
            arguments: null);

        // Celery message format: [[args], {kwargs}, {embed}]
        var body = JsonSerializer.Serialize(new object[]
        {
            new object[] { message },
            new Dictionary<string, object>(),
            new { callbacks = (object?)null, errbacks = (object?)null, chain = (object?)null, chord = (object?)null }
        });

        var bodyBytes = Encoding.UTF8.GetBytes(body);

        var props = new BasicProperties
        {
            ContentType = "application/json",
            ContentEncoding = "utf-8",
            DeliveryMode = DeliveryModes.Persistent,
            Headers = new Dictionary<string, object?>
            {
                ["task"] = taskName,
                ["id"] = taskId,
                ["lang"] = "py",
                ["retries"] = 0,
                ["root_id"] = taskId,
            }
        };

        await channel.BasicPublishAsync(
            exchange: "",
            routingKey: "celery",
            mandatory: false,
            basicProperties: props,
            body: bodyBytes);

        _logger.LogInformation("Published Celery task {TaskName} with id {TaskId}", taskName, taskId);

        return taskId;
    }
}
