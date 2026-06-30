import {
    AutocompleteInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    Colors,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import {GitHub, Linear, LinearStates} from "../clients";
import {
    branchName,
    getLinearUser,
    getStatusMessage,
    getUsers,
    ProjectRoles,
    registerChannel,
    updateStatusMessage
} from "../util";
import {Issue, IssueConnection} from "@linear/sdk";

export async function allIssues() {
    let issues: Issue[] = [];

    let res: IssueConnection;
    do {
        res = await (res?.fetchNext() ?? Linear.issues());
        issues.push(...res.nodes);
    } while (res.pageInfo.hasNextPage)

    return issues;
}

export async function autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const results = (await allIssues()).filter(n=>
        n.title.toLowerCase().includes(focused) || n.identifier.toLowerCase().includes(focused))
        .sort();
    await interaction.respond(
        results.slice(0, 25).map(issue => ({
            name: `${issue.identifier} — ${issue.title}`.slice(0, 100),
            value: issue.id,
        })),
    );
}

export async function execute(interaction: ChatInputCommandInteraction) {
    const issueId = interaction.options.getString('issue', true);
    const owner = interaction.options.getUser('owner', true);
    const dueDateInput = interaction.options.getString('due_date', true).trim();

    const [year, month, day] = dueDateInput.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDateInput) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle("🚨 Invalid Due Date")
                .setDescription("Due date must be in `YYYY-MM-DD` format.")
                .setColor(Colors.DarkRed)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const ownerLinearId = await getLinearUser(owner.id);
    if (!ownerLinearId) {
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle("🚨 Linear User Not Found")
                .setDescription(`${owner} is not linked to Linear. Use \`/link\` first.`)
                .setColor(Colors.DarkRed)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    let issue: Issue;
    try { issue = await Linear.issue(issueId); } catch (error) {}
    if (!issue) {
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle("🚨 Issue Not Found")
                .setDescription("The selected Linear issue could not be found.")
                .setColor(Colors.DarkRed)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({flags: MessageFlags.Ephemeral});

    const branch = branchName(issue);
    const channelName = branch.slice(0, 100);

    let githubError = false;
    try {
        const owner = process.env.GITHUB_OWNER!;
        const repo = process.env.GITHUB_REPO!;
        const {data: ref} = await GitHub.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${process.env.GITHUB_BASE_BRANCH}`
        });

        await GitHub.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${branch}`,
            sha: ref.object.sha,
        });
    } catch (error: any) {
        console.log(error);
        githubError = error?.status !== 422;
    }

    let update;
    try {
        update = await Linear.updateIssue(issue.id, {
            stateId: LinearStates['In Development'],
            assigneeId: ownerLinearId,
            dueDate: dueDateInput,
        });
    } catch (error) { console.log(error); }
    let linearError = !update?.success;

    const codeReviewers = await getUsers(ProjectRoles.CodeReviewer);
    const qaReviewers = await getUsers(ProjectRoles.QAReviewer);
    const pingIds = [...new Set([interaction.user.id, owner.id, ...codeReviewers, ...qaReviewers])];

    const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: process.env.DISCORD_ISSUE_CATEGORY,
        topic: `[${issue.identifier}] ${issue.title}`,
    });
    await registerChannel(issueId, channel.id);

    await updateStatusMessage(issueId, (await channel.send({
        content: pingIds.map(id => `<@${id}>`).join(' '),
        ...(await getStatusMessage(issueId)),
    })).id);

    await interaction.editReply({
        embeds: [new EmbedBuilder()
            .setTitle("Issue Assigned")
            .setDescription([
                `Assigned **${issue.identifier}** to ${owner}.`,
                `GitHub Branch: \`${branch}\``,
                `Channel: <#${channel.id}>`,
            ].join('\n'))
            .setColor(Colors.Green)],
    });

    if (githubError) {
        await interaction.followUp({
            embeds: [new EmbedBuilder()
                .setTitle("🚨 Branch Creation Failed")
                .setDescription(`Failed to create the git branch on GitHub. Please manually create a branch with name \`${branch}\``)
                .setColor(Colors.DarkRed)],
            flags: MessageFlags.Ephemeral
        });
    }
    if (linearError) {
        await interaction.followUp({
            embeds: [new EmbedBuilder()
                .setTitle("🚨 Linear Update Failed")
                .setDescription("The branch was created, but the issue could not be updated in Linear. Please manually move it to In Development, assign the user, and update the due date.")
                .setColor(Colors.DarkRed)],
            flags: MessageFlags.Ephemeral
        });
    }
}
