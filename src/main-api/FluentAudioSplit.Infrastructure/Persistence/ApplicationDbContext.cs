using FluentAudioSplit.Domain.Entities;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace FluentAudioSplit.Infrastructure.Persistence;

public class ApplicationDbContext : IdentityDbContext<ApplicationUser>
{
    // SQLite stores DateTime as text without timezone info, so values round-trip with
    // DateTimeKind.Unspecified. System.Text.Json then serializes them WITHOUT a 'Z', and the
    // browser interprets them as local time — shifting every timestamp by the viewer's offset.
    // These converters guarantee everything is written and read back as UTC (Kind=Utc) so the
    // API always emits proper ISO-8601 'Z' timestamps.
    private sealed class UtcDateTimeConverter : ValueConverter<DateTime, DateTime>
    {
        public UtcDateTimeConverter() : base(
            v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(),
            v => DateTime.SpecifyKind(v, DateTimeKind.Utc))
        { }
    }

    private sealed class UtcNullableDateTimeConverter : ValueConverter<DateTime?, DateTime?>
    {
        public UtcNullableDateTimeConverter() : base(
            v => v.HasValue ? (v.Value.Kind == DateTimeKind.Utc ? v.Value : v.Value.ToUniversalTime()) : v,
            v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v)
        { }
    }

    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options) { }

    public DbSet<Workflow> Workflows => Set<Workflow>();
    public DbSet<FileRecord> FileRecords => Set<FileRecord>();
    public DbSet<WorkflowVersion> WorkflowVersions => Set<WorkflowVersion>();
    public DbSet<WorkflowExecution> WorkflowExecutions => Set<WorkflowExecution>();
    public DbSet<NodeExecution> NodeExecutions => Set<NodeExecution>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Workflow>(e =>
        {
            e.HasKey(w => w.Id);
            e.HasOne(w => w.User)
             .WithMany()
             .HasForeignKey(w => w.UserId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasMany(w => w.Versions)
             .WithOne(v => v.Workflow)
             .HasForeignKey(v => v.WorkflowId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<WorkflowVersion>(e =>
        {
            e.HasKey(v => v.Id);
        });

        builder.Entity<FileRecord>(e =>
        {
            e.HasKey(f => f.Id);
            e.HasOne(f => f.User)
             .WithMany()
             .HasForeignKey(f => f.UserId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<WorkflowExecution>(e =>
        {
            e.HasKey(we => we.Id);
            e.HasOne(we => we.WorkflowVersion)
             .WithMany()
             .HasForeignKey(we => we.WorkflowVersionId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(we => we.User)
             .WithMany()
             .HasForeignKey(we => we.UserId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(we => we.InputFileRecord)
             .WithMany()
             .HasForeignKey(we => we.InputFileRecordId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasMany(we => we.NodeExecutions)
             .WithOne(ne => ne.WorkflowExecution)
             .HasForeignKey(ne => ne.WorkflowExecutionId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<NodeExecution>(e =>
        {
            e.HasKey(ne => ne.Id);
        });
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        base.ConfigureConventions(builder);
        builder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        builder.Properties<DateTime?>().HaveConversion<UtcNullableDateTimeConverter>();
    }
}
