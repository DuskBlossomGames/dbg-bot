import {
    CommandInteraction,
    LabelBuilder,
    ModalBuilder, ModalSubmitInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
    EmbedBuilder,
    Colors,
    MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, TextInputComponent
} from "discord.js";
import {Linear, linearOauth} from "../clients";
import {getClosestCircleEmoji, getLinearUser, ProjectRoles, registerUser} from "../util";

export async function execute(interaction: CommandInteraction) {
    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setTitle("Authorize Bot")
            .setDescription("To provision a new auth token, click the first button to auth with Linear. After it redirects, copy the URL and click the second button to enter it.")
            .setColor(Colors.Blue)],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setLabel("Start OAuth Login")
                .setStyle(ButtonStyle.Link)
                .setURL(`https://linear.app/oauth/authorize?client_id=${process.env.LINEAR_CLIENT_ID}&redirect_uri=http://localhost&response_type=code&scope=read,write,issues:create,comments:create,timeSchedule:write,admin&prompt=consent&actor=app`),
            new ButtonBuilder()
                .setCustomId("linear_token_input_button")
                .setLabel("Enter URL")
                .setStyle(ButtonStyle.Secondary)
        )],
        flags: MessageFlags.Ephemeral
    });
}

export const buttons = {
    'linear_token_input_button': async (interaction: ButtonInteraction) => {
        await interaction.showModal(
            new ModalBuilder()
                .setCustomId("linear_token_input_modal")
                .setTitle("Input Linear Token")
                .addLabelComponents(
                    new LabelBuilder()
                        .setLabel("Linear Token URL")
                        .setDescription("Input the URL Linear redirected to.")
                        .setTextInputComponent(new TextInputBuilder()
                            .setCustomId('linear_token')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder("http://localhost...")
                            .setRequired(true))))
    }
}

export const modals = {
    'linear_token_input_modal': async (interaction: ModalSubmitInteraction) => {
        const url = interaction.fields.getTextInputValue('linear_token')!;

        const regex = /https:\/\/localhost.com\/oauth\/callback\?code=([0-9a-f]{40})/g
        if (!regex.test(url)) {
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle("Invalid URL")
                    .setDescription("Redirect URL must be of the form 'https://localhost.com/oauth/callback?code=<code>'")
                    .setColor(Colors.DarkRed)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        const token = regex.exec(url)![1];
        await linearOauth(token);

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle("Linear OAuth Complete")
                .setDescription("Linear client is now connected.")
                .setColor(Colors.Green)],
            flags: MessageFlags.Ephemeral
        });
    }
}