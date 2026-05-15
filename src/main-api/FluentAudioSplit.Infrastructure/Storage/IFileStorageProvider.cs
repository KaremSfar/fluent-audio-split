namespace FluentAudioSplit.Infrastructure.Storage;

public interface IFileStorageProvider
{
    Task<Stream> ReadAsync(string relativePath, CancellationToken ct = default);
    Task WriteAsync(string relativePath, Stream content, CancellationToken ct = default);
    Task<bool> ExistsAsync(string relativePath, CancellationToken ct = default);
    Task<IReadOnlyList<string>> ListAsync(string relativeDir, CancellationToken ct = default);
    Task DeleteAsync(string relativePath, CancellationToken ct = default);
    string GetAbsolutePath(string relativePath);
}
