import {Colors, CommandInteraction, EmbedBuilder, MessageFlags} from "discord.js";

export async function execute(interaction: CommandInteraction) {
    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setTitle("DBG Bot Help")
            .setDescription("This is the help command.")
            .setColor(Colors.Blurple)],
        flags: MessageFlags.Ephemeral
    });
}