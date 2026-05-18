using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FluentAudioSplit.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class WorkflowVersioning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_NodeExecutions_WorkflowNodes_WorkflowNodeId",
                table: "NodeExecutions");

            migrationBuilder.DropForeignKey(
                name: "FK_WorkflowExecutions_Workflows_WorkflowId",
                table: "WorkflowExecutions");

            migrationBuilder.DropTable(
                name: "WorkflowNodes");

            migrationBuilder.DropIndex(
                name: "IX_WorkflowExecutions_WorkflowId",
                table: "WorkflowExecutions");

            migrationBuilder.DropIndex(
                name: "IX_NodeExecutions_WorkflowNodeId",
                table: "NodeExecutions");

            migrationBuilder.AddColumn<Guid>(
                name: "WorkflowVersionId",
                table: "WorkflowExecutions",
                type: "TEXT",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateTable(
                name: "WorkflowVersions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    WorkflowId = table.Column<Guid>(type: "TEXT", nullable: false),
                    VersionNumber = table.Column<int>(type: "INTEGER", nullable: false),
                    StructureJson = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkflowVersions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkflowVersions_Workflows_WorkflowId",
                        column: x => x.WorkflowId,
                        principalTable: "Workflows",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkflowExecutions_WorkflowVersionId",
                table: "WorkflowExecutions",
                column: "WorkflowVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkflowVersions_WorkflowId",
                table: "WorkflowVersions",
                column: "WorkflowId");

            migrationBuilder.AddForeignKey(
                name: "FK_WorkflowExecutions_WorkflowVersions_WorkflowVersionId",
                table: "WorkflowExecutions",
                column: "WorkflowVersionId",
                principalTable: "WorkflowVersions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_WorkflowExecutions_WorkflowVersions_WorkflowVersionId",
                table: "WorkflowExecutions");

            migrationBuilder.DropTable(
                name: "WorkflowVersions");

            migrationBuilder.DropIndex(
                name: "IX_WorkflowExecutions_WorkflowVersionId",
                table: "WorkflowExecutions");

            migrationBuilder.DropColumn(
                name: "WorkflowVersionId",
                table: "WorkflowExecutions");

            migrationBuilder.CreateTable(
                name: "WorkflowNodes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    SourceNodeId = table.Column<Guid>(type: "TEXT", nullable: true),
                    WorkflowId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ConfigJson = table.Column<string>(type: "TEXT", nullable: false),
                    NodeType = table.Column<string>(type: "TEXT", nullable: false),
                    Order = table.Column<int>(type: "INTEGER", nullable: false),
                    SourceOutputName = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkflowNodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkflowNodes_WorkflowNodes_SourceNodeId",
                        column: x => x.SourceNodeId,
                        principalTable: "WorkflowNodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_WorkflowNodes_Workflows_WorkflowId",
                        column: x => x.WorkflowId,
                        principalTable: "Workflows",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkflowExecutions_WorkflowId",
                table: "WorkflowExecutions",
                column: "WorkflowId");

            migrationBuilder.CreateIndex(
                name: "IX_NodeExecutions_WorkflowNodeId",
                table: "NodeExecutions",
                column: "WorkflowNodeId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkflowNodes_SourceNodeId",
                table: "WorkflowNodes",
                column: "SourceNodeId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkflowNodes_WorkflowId",
                table: "WorkflowNodes",
                column: "WorkflowId");

            migrationBuilder.AddForeignKey(
                name: "FK_NodeExecutions_WorkflowNodes_WorkflowNodeId",
                table: "NodeExecutions",
                column: "WorkflowNodeId",
                principalTable: "WorkflowNodes",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_WorkflowExecutions_Workflows_WorkflowId",
                table: "WorkflowExecutions",
                column: "WorkflowId",
                principalTable: "Workflows",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
