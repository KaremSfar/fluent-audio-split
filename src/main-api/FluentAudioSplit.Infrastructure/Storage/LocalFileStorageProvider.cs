namespace FluentAudioSplit.Infrastructure.Storage;

public class LocalFileStorageProvider : IFileStorageProvider
{
    private readonly string _basePath;

    public LocalFileStorageProvider(string basePath)
    {
        _basePath = basePath;
    }

    public string GetAbsolutePath(string relativePath) =>
        Path.Combine(_basePath, relativePath);

    public Task<Stream> ReadAsync(string relativePath, CancellationToken ct = default)
    {
        var fullPath = GetAbsolutePath(relativePath);
        Stream stream = File.OpenRead(fullPath);
        return Task.FromResult(stream);
    }

    public async Task WriteAsync(string relativePath, Stream content, CancellationToken ct = default)
    {
        var fullPath = GetAbsolutePath(relativePath);
        var dir = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        await using var fs = File.Create(fullPath);
        await content.CopyToAsync(fs, ct);
    }

    public Task<bool> ExistsAsync(string relativePath, CancellationToken ct = default) =>
        Task.FromResult(File.Exists(GetAbsolutePath(relativePath)));

    public Task<IReadOnlyList<string>> ListAsync(string relativeDir, CancellationToken ct = default)
    {
        var fullDir = GetAbsolutePath(relativeDir);
        if (!Directory.Exists(fullDir))
            return Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());

        var files = Directory.GetFiles(fullDir, "*", SearchOption.AllDirectories)
            .Select(f => Path.GetRelativePath(_basePath, f))
            .ToList();

        return Task.FromResult<IReadOnlyList<string>>(files);
    }

    public Task DeleteAsync(string relativePath, CancellationToken ct = default)
    {
        var fullPath = GetAbsolutePath(relativePath);
        if (File.Exists(fullPath))
            File.Delete(fullPath);
        return Task.CompletedTask;
    }
}
