namespace FluentAudioSplit.Domain.Entities;

public class FileRecord
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public ApplicationUser User { get; set; } = null!;
    public string OriginalFileName { get; set; } = string.Empty;
    public string StoragePath { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public string? ContentHash { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
