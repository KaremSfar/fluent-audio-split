using FluentAudioSplit.Domain.Entities;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace FluentAudioSplit.Infrastructure.Persistence;

public class ApplicationDbContext : IdentityDbContext<ApplicationUser>
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options) { }

    public DbSet<Workflow> Workflows => Set<Workflow>();
    public DbSet<FileRecord> FileRecords => Set<FileRecord>();
    public DbSet<WorkflowNode> WorkflowNodes => Set<WorkflowNode>();
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
            e.HasMany(w => w.Nodes)
             .WithOne(n => n.Workflow)
             .HasForeignKey(n => n.WorkflowId)
             .OnDelete(DeleteBehavior.Cascade);
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
            e.HasOne(we => we.Workflow)
             .WithMany()
             .HasForeignKey(we => we.WorkflowId)
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
            e.HasOne(ne => ne.WorkflowNode)
             .WithMany()
             .HasForeignKey(ne => ne.WorkflowNodeId)
             .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
