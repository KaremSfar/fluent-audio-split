using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FluentAudioSplit.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNodeConnections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SourceNodeId",
                table: "WorkflowNodes",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceOutputName",
                table: "WorkflowNodes",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkflowNodes_SourceNodeId",
                table: "WorkflowNodes",
                column: "SourceNodeId");

            migrationBuilder.AddForeignKey(
                name: "FK_WorkflowNodes_WorkflowNodes_SourceNodeId",
                table: "WorkflowNodes",
                column: "SourceNodeId",
                principalTable: "WorkflowNodes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_WorkflowNodes_WorkflowNodes_SourceNodeId",
                table: "WorkflowNodes");

            migrationBuilder.DropIndex(
                name: "IX_WorkflowNodes_SourceNodeId",
                table: "WorkflowNodes");

            migrationBuilder.DropColumn(
                name: "SourceNodeId",
                table: "WorkflowNodes");

            migrationBuilder.DropColumn(
                name: "SourceOutputName",
                table: "WorkflowNodes");
        }
    }
}
