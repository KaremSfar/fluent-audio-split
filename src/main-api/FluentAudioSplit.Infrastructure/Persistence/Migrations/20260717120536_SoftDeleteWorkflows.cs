using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FluentAudioSplit.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SoftDeleteWorkflows : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Workflows",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Workflows");
        }
    }
}
