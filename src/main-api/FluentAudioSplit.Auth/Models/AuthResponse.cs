namespace FluentAudioSplit.Auth.Models;

public record AuthResponse(
    string AccessToken,
    string TokenType,
    int ExpiresIn,
    string? RefreshToken = null
);
