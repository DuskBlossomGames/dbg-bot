import {
    ActionRowBuilder,
    CommandInteraction,
    Colors,
    EmbedBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle, ButtonBuilder,
    ButtonStyle, ButtonInteraction
} from "discord.js";
import {getClosestCircleEmoji, getLinearUser} from "../util";
import {Linear, LinearStates, LinearTeam} from "../clients";

export async function execute(interaction: CommandInteraction) {
    const labels = (await Linear.issueLabels({ first: 25 })).nodes;
    await interaction.showModal(
        new ModalBuilder()
            .setCustomId("create_issue_modal")
            .setTitle("Create Linear Issue")
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel("Project")
                    .setDescription("Select the project for the issue.")
                    .setStringSelectMenuComponent(new StringSelectMenuBuilder()
                        .setCustomId('project')
                        .setRequired(true)
                        .addOptions(
                            ...(await Linear.projects({ first: 25 })).nodes
                                .sort((a,b)=>a.name.localeCompare(b.name))
                                .map((p) =>new StringSelectMenuOptionBuilder()
                                    .setLabel(p.name)
                                    .setValue(p.id)))),
                new LabelBuilder()
                    .setLabel("Labels")
                    .setDescription("Select the labels for the issue.")
                    .setStringSelectMenuComponent(new StringSelectMenuBuilder()
                        .setCustomId("labels")
                        .setRequired(true)
                        .setMinValues(1)
                        .setMaxValues(labels.length)
                        .addOptions(labels.map(l => new StringSelectMenuOptionBuilder()
                            .setLabel(l.name)
                            .setValue(l.id)
                            .setEmoji(getClosestCircleEmoji(l.color))))),
                new LabelBuilder()
                    .setLabel("Title")
                    .setDescription("A short, descriptive title.")
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId("title")
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder("Enter a title...")
                            .setRequired(true)),
                new LabelBuilder()
                    .setLabel("Description")
                    .setDescription("Be descriptive and actionable. Use lists and Markdown syntax.")
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId("description")
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder("Describe the issue...")
                            .setRequired(true)),
                new LabelBuilder()
                    .setLabel("Deliverables")
                    .setDescription("Give detailed, specific deliverables. Use lists and Markdown syntax. Include a proposed timeline.")
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId("deliverables")
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder("1. Deliverable 1\n2. Deliverable 2\n\nProposed Timeline: 2 days")
                            .setRequired(true))));
}

export const modals = {
    'create_issue_modal': async (interaction: ModalSubmitInteraction) => {
        const projectId = interaction.fields.getStringSelectValues('project')[0];
        const labelIds = interaction.fields.getStringSelectValues('labels') as string[];
        const title = interaction.fields.getTextInputValue('title');
        const description = interaction.fields.getTextInputValue('description');
        const deliverables = interaction.fields.getTextInputValue('deliverables');

        if (await getLinearUser(interaction.user.id) === undefined) {
            await interaction.reply({embeds: [new EmbedBuilder()
                    .setTitle("🚨 Linear User Not Found")
                    .setDescription("Use `/link` to link your Discord account to your Linear account and try again.")
                    .setColor(Colors.DarkRed)], flags: MessageFlags.Ephemeral});
            return;
        }

        const creator = await Linear.user(await getLinearUser(interaction.user.id));
        const issue = await Linear.createIssue({
            teamId: LinearTeam, // Voidwatch team UUID
            createAsUser: creator.name,
            projectId,
            labelIds,
            title,
            stateId: LinearStates.Todo,
            description: `### Description\n${description}\n\n### Deliverables\n${deliverables}`})

        if (issue.success && issue.issue) {
            const issueData = await issue.issue;
            const labels = await issueData.labels();
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle(`${issueData.identifier} - ${issueData.title}`)
                    .setURL(issueData.url)
                    .setDescription(description)
                    // .addFields({
                    //     name: 'Labels',
                    //     value:
                    // })
                    .setColor(Colors.Green)
                    .setFooter({text: `Labels: ${labels.nodes.map(l=>l.name).join(' ⋅ ')}\nCreated by ${creator.name}`, iconURL: creator.avatarUrl})],
                components: [new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('create_issue_undo_button|'+issueData.id)
                            .setStyle(ButtonStyle.Danger)
                            .setLabel('Undo'),
                        new ButtonBuilder()
                            .setLabel('Open')
                            .setStyle(ButtonStyle.Link)
                            .setURL(issueData.url))]});
        } else {
            await interaction.reply({embeds: [new EmbedBuilder()
                    .setTitle("🚨 Failed to Create Issue")
                    .setDescription("There was an error creating the Linear issue. Please try again.")
                    .setColor(Colors.DarkRed)]});
        }
    }
}

export const buttons = {
    'create_issue_undo_button\\|.*': async (interaction: ButtonInteraction) => {
        const issueId = interaction.customId.split('|')[1]
        const response = await Linear.deleteIssue(issueId);

        if (response.success) {
            await interaction.message.delete();
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle("Issue Deleted")
                    .setDescription("The Linear issue has been successfully deleted.")
                    .setColor(Colors.Green)],
                flags: MessageFlags.Ephemeral
            });
        } else {
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle("🚨 Failed to Delete Issue")
                    .setDescription("There was an error deleting the Linear issue. Please try again.")
                    .setColor(Colors.DarkRed)],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}