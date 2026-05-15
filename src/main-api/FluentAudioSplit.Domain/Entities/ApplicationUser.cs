using Microsoft.AspNetCore.Identity;

namespace FluentAudioSplit.Domain.Entities;

public class ApplicationUser : IdentityUser
{
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
