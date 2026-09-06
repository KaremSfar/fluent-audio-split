using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FluentAudioSplit.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNodeExecutionUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_NodeExecutions_WorkflowExecutionId",
                table: "NodeExecutions");

            migrationBuilder.CreateIndex(
                name: "IX_NodeExecutions_WorkflowExecutionId_WorkflowNodeId_Attempt",
                table: "NodeExecutions",
                columns: new[] { "WorkflowExecutionId", "WorkflowNodeId", "Attempt" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_NodeExecutions_WorkflowExecutionId_WorkflowNodeId_Attempt",
                table: "NodeExecutions");

            migrationBuilder.CreateIndex(
                name: "IX_NodeExecutions_WorkflowExecutionId",
                table: "NodeExecutions",
                column: "WorkflowExecutionId");
        }
    }
}
