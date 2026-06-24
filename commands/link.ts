import {
    CommandInteraction,
    LabelBuilder,
    ModalBuilder, ModalSubmitInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
    EmbedBuilder,
    Colors,
    MessageFlags
} from "discord.js";
import {Linear} from "../clients";
import {getClosestCircleEmoji, getLinearUser, ProjectRoles, registerUser} from "../util";

export async function execute(interaction: CommandInteraction) {
    await interaction.showModal(
        new ModalBuilder()
            .setCustomId("link_user_modal")
            .setTitle("Link Linear User")
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel("Discord User")
                    .setDescription("Select the Discord user to link.")
                    .setUserSelectMenuComponent(new UserSelectMenuBuilder()
                        .setCustomId('discord_user')
                        .setRequired(true)),
                new LabelBuilder()
                    .setLabel("Linear User")
                    .setDescription("Select the Linear user to link.")
                    .setStringSelectMenuComponent(new StringSelectMenuBuilder()
                        .setCustomId("linear_user")
                        .setRequired(true)
                        .setOptions((await Linear.users({first: 25})).nodes.map(u=>
                            new StringSelectMenuOptionBuilder()
                                .setLabel(u.name)
                                .setValue(u.id)))),
                new LabelBuilder()
                    .setLabel("Project Roles")
                    .setDescription("Select any roles the user should have in the project.")
                    .setStringSelectMenuComponent(new StringSelectMenuBuilder()
                        .setCustomId("roles")
                        .setRequired(true)
                        .setMinValues(1)
                        .setMaxValues(Object.values(ProjectRoles).length)
                        .setOptions(Object.keys(ProjectRoles).map(e=>
                            new StringSelectMenuOptionBuilder()
                                .setLabel(ProjectRoles[e])
                                .setValue(e))))));
}

export const modals = {
    'link_user_modal': async (interaction: ModalSubmitInteraction) => {
        const discord = interaction.fields.getSelectedUsers('discord_user').keyAt(0);
        const linear = interaction.fields.getStringSelectValues('linear_user')[0];
        const roles = interaction.fields.getStringSelectValues('roles').map(s=>s as ProjectRoles);

        const existed = await getLinearUser(discord) !== undefined;
        
        await registerUser(discord, linear, roles);

        const linearName = (await Linear.user(linear)).name;

        const mention = `<@${discord}>`
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle("User Linked")
                .setDescription(existed
                    ? `${mention} has been relinked to ${linearName}.`
                    : `${mention} has been successfully linked to ${linearName}.`)
                .setColor(Colors.Green)],
            flags: MessageFlags.Ephemeral
        });
    }
}