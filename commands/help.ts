import {Colors, CommandInteraction, EmbedBuilder, MessageFlags} from "discord.js";

export async function execute(interaction: CommandInteraction) {
    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setTitle("DBG Bot Help")
            .setDescription("A Discord bot for managing Linear issues, GitHub branches, and issue workflow.")
            .setColor(Colors.Blurple)
            .addFields(
                {
                    name: "/issue",
                    value: "Create a new Linear issue. Opens a form to set the project, labels, title, description, and deliverables. Requires your Discord account to be linked via `/link`.",
                },
                {
                    name: "/link",
                    value: "Link a Discord user to a Linear user and assign project roles (Code Reviewer, QA Reviewer). Requires the Manage Roles permission.",
                },
                {
                    name: "/assign",
                    value: "Assign a Linear issue to a user. Creates a GitHub branch, sets the due date, moves the issue to In Development, and opens a dedicated Discord channel.",
                },
                {
                    name: "/status",
                    value: "Advance or revert issue workflow in an issue channel. Subcommands: `continue-dev`, `code-review`, `qa-review`, `qa-accept`, `merged`. Status buttons on the pinned message do the same thing.",
                },
                {
                    name: "Automated reminders",
                    value: "Issue channels receive a refreshed status message daily at 8 AM PT and a status update reminder at 7 PM PT if no update was posted that day.",
                },
            )],
        flags: MessageFlags.Ephemeral,
    });
}
