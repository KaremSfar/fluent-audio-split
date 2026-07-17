using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FluentAudioSplit.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAudioTrimAndContentHash : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "TrimEndSeconds",
                table: "WorkflowExecutions",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "TrimStartSeconds",
                table: "WorkflowExecutions",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContentHash",
                table: "FileRecords",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TrimEndSeconds",
                table: "WorkflowExecutions");

            migrationBuilder.DropColumn(
                name: "TrimStartSeconds",
                table: "WorkflowExecutions");

            migrationBuilder.DropColumn(
                name: "ContentHash",
                table: "FileRecords");
        }
    }
}
