using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FluentAudioSplit.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNodeOutputPaths : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OutputArtifactPathsJson",
                table: "NodeExecutions",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OutputArtifactPathsJson",
                table: "NodeExecutions");
        }
    }
}
