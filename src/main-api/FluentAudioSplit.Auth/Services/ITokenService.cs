using FluentAudioSplit.Domain.Entities;

namespace FluentAudioSplit.Auth.Services;

public interface ITokenService
{
    string GenerateAccessToken(ApplicationUser user);
}
