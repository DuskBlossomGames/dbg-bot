import {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Colors,
    EmbedBuilder, GuildMember,
    MessageFlags,
} from "discord.js";
import {Linear, LinearStates} from "../clients";
import {
    branchName, getDiscordUser, getIssue,
    getLastStatusMessage, getStatusMessage, getUsers, ProjectRoles, removeIssue
} from "../util";
import {Issue} from "@linear/sdk";

type StatusInteraction = ChatInputCommandInteraction | ButtonInteraction;

async function requireIssueChannel(interaction: StatusInteraction, issueId?: string) {
    const channelIssueId = await getIssue(interaction.channelId);
    if (!channelIssueId) {
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle("🚨 Not an Issue Channel")
                .setDescription("This can only be used in an issue channel.")
                .setColor(Colors.DarkRed)],
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }
    if (issueId && channelIssueId !== issueId) {
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle("🚨 Issue Mismatch")
                .setDescription("This action does not match the issue for this channel. This should be impossible.")
                .setColor(Colors.DarkRed)],
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }
    return channelIssueId;
}

async function requireStates(interaction: StatusInteraction, issue: string, states: (keyof typeof LinearStates)[]) {
    const state = await (await Linear.issue(issue)).state;
    if (!states.map(s=>LinearStates[s]).includes(state.id)) {
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle("🚨 Invalid State Transition")
                .setDescription(`This issue is currently in the ${state.name} state. This interaction is only valid for the ${states.join(', ')} state(s).`)
                .setColor(Colors.DarkRed)],
            flags: MessageFlags.Ephemeral,
        });

        return false;
    }

    return true;
}

async function updateState(interaction: StatusInteraction, issueId: string, stateId: string) {
    let update;
    try { update = await Linear.updateIssue(issueId, {stateId}); } catch (e) { console.log(e); }
    if (!update.success) {
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle("🚨 Linear Update Failed")
                .setDescription("Could not update the issue status in Linear.")
                .setColor(Colors.DarkRed)],
            flags: MessageFlags.Ephemeral,
        });
        return false;
    }
    return true;
}

async function sendTransition(interaction: StatusInteraction, issueId: string, content: string, title: string, description?: string) {
    const channel = interaction.channel;
    if (!channel?.isSendable()) return;

    await interaction.reply({
        content: content,
        embeds: [new EmbedBuilder()
            .setTitle(title)
            .setDescription(description ?? null)
            .setFooter({text: `Initiated by ${(interaction.member as GuildMember).displayName}`, iconURL: interaction.user.avatarURL()})
            .setColor(Colors.Green)]});

    await channel.messages.edit(await getLastStatusMessage(issueId), await getStatusMessage(issueId));
}

function mention(ids: (string | undefined)[]) {
    return [...new Set(ids.filter(Boolean))].map(id => `<@${id}>`).join(' ');
}

async function continueDev(interaction: StatusInteraction, issueId?: string) {
    const id = await requireIssueChannel(interaction, issueId);
    if (!id) return;

    if (!await requireStates(interaction, id, ['Code Review', 'QA Ready'])) return;

    const issue = await Linear.issue(id);
    const assignee = await issue.assignee;
    const ownerId = assignee ? await getDiscordUser(assignee.id) : undefined;

    if (!await updateState(interaction, id, LinearStates['In Development'])) return;
    await sendTransition(interaction, id, mention([ownerId]), "Moved to In Development");
}

async function codeReview(interaction: StatusInteraction, issueId?: string) {
    const id = await requireIssueChannel(interaction, issueId);
    if (!id) return;

    if (!await requireStates(interaction, id, ['In Development'])) return;

    const reviewers = await getUsers(ProjectRoles.CodeReviewer);

    if (!await updateState(interaction, id, LinearStates['Code Review'])) return;
    await sendTransition(interaction, id, mention(reviewers), "Moved to Code Review");
}

async function qaReview(interaction: StatusInteraction, issueId?: string) {
    const id = await requireIssueChannel(interaction, issueId);
    if (!id) return;

    if (!await requireStates(interaction, id, ['Code Review'])) return;

    const reviewers = await getUsers(ProjectRoles.QAReviewer);

    if (!await updateState(interaction, id, LinearStates['QA Ready'])) return;
    await sendTransition(interaction, id, mention(reviewers), "Moved to QA Ready");
}

async function qaAccept(interaction: StatusInteraction, issueId?: string) {
    const id = await requireIssueChannel(interaction, issueId);
    if (!id) return;

    if (!await requireStates(interaction, id, ['QA Ready'])) return;

    const issue = await Linear.issue(id);
    const reviewers = await getUsers(ProjectRoles.CodeReviewer);
    const branch = branchName(issue);
    const base = process.env.GITHUB_BASE_BRANCH!;
    const mergeUrl = `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/compare/${base}...${branch}?expand=1`;

    if (!await updateState(interaction, id, LinearStates['Done'])) return;
    await sendTransition(
        interaction,
        id,
        `${mention(reviewers)}`,
        "Moved to Done",
        `Please merge \`${branch}\` into \`${base}\`: [Compare View](${mergeUrl})`
    );
}

async function merged(interaction: StatusInteraction, issueId?: string) {
    const id = await requireIssueChannel(interaction, issueId);
    if (!id) return;

    if (!await requireStates(interaction, id, ['Done'])) return;

    await removeIssue(id);
    await interaction.channel.edit({parent: process.env.DISCORD_ARCHIVE_CATEGORY})

    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setTitle("Issue Closed")
            .setDescription("Channel archived and issue deregistered from watchers.")
            .setColor(Colors.Green)]});
}

const subcommands = {
    'continue-dev': continueDev,
    'code-review': codeReview,
    'qa-review': qaReview,
    'qa-accept': qaAccept,
    'merged': merged,
} as const;

export async function execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    await subcommands[subcommand](interaction);
}

function buttonHandler(fn: (interaction: ButtonInteraction, issueId: string) => Promise<void>) {
    return async (interaction: ButtonInteraction) => {
        const issueId = interaction.customId.split('|')[1];
        await fn(interaction, issueId);
    };
}

export const buttons = {
    'reset_dev\\|.*': buttonHandler((i, id) => continueDev(i, id)),
    'code_review\\|.*': buttonHandler((i, id) => codeReview(i, id)),
    'qa_review\\|.*': buttonHandler((i, id) => qaReview(i, id)),
    'merge\\|.*': buttonHandler((i, id) => qaAccept(i, id)),
    'merged\\|.*': buttonHandler((i, id) => merged(i, id)),
};
