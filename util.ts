import {
    Snowflake,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    Colors,
    Guild,
    ChannelType
} from "discord.js";
import {readFile, writeFile} from "node:fs/promises";
import {writeFileSync, existsSync} from 'node:fs'
import {Linear, LinearStates} from "./clients";
import {Issue, WorkflowState} from "@linear/sdk";

export enum ProjectRoles { CodeReviewer = "Code Reviewer", QAReviewer = "QA Reviewer" }
export type UserData = {linear: string, roles: ProjectRoles[]}
type UserMap = {[idx: Snowflake]: UserData}
type IssueMap = {[issue: string]: {channel: Snowflake, lastStatus?: Snowflake}}

const USER_MAP_FILE = "usermap.json"
if (!existsSync(USER_MAP_FILE)) writeFileSync(USER_MAP_FILE, '{}')
const ISSUE_MAP_FILE = "issuemap.json"
if (!existsSync(ISSUE_MAP_FILE)) writeFileSync(ISSUE_MAP_FILE, '{}')

export async function registerUser(discord: Snowflake, linear: string, roles: ProjectRoles[]) {
    const map = JSON.parse(await readFile(USER_MAP_FILE, 'utf-8')) as UserMap;
    map[discord] = {linear, roles: roles};
    await writeFile(USER_MAP_FILE, JSON.stringify(map));
}

export async function getLinearUser(discord: Snowflake) {
    return JSON.parse(await readFile(USER_MAP_FILE, 'utf-8'))[discord]?.linear;
}

export async function getDiscordUser(linear: string) {
    const map = JSON.parse(await readFile(USER_MAP_FILE, 'utf-8')) as UserMap;
    return Object.keys(map).find(key=>map[key].linear === linear)!;
}

export async function getUsers(role: ProjectRoles) {
    const map = JSON.parse(await readFile(USER_MAP_FILE, 'utf-8')) as UserMap;

    return Object.keys(map).filter(k=>map[k].roles.includes(role))
}

export async function registerChannel(issueId: string, channel: Snowflake) {
    const map = JSON.parse(await readFile(ISSUE_MAP_FILE, 'utf-8')) as IssueMap;
    map[issueId] = {channel};
    await writeFile(ISSUE_MAP_FILE, JSON.stringify(map));
}

export async function updateStatusMessage(issueId: string, msg: Snowflake) {
    const map = JSON.parse(await readFile(ISSUE_MAP_FILE, 'utf-8')) as IssueMap;
    map[issueId].lastStatus = msg;
    await writeFile(ISSUE_MAP_FILE, JSON.stringify(map));
}

export async function getIssue(channel: Snowflake) {
    const map = JSON.parse(await readFile(ISSUE_MAP_FILE, 'utf-8')) as IssueMap;
    return Object.keys(map).find(key=>map[key].channel === channel);
}

export async function getLastStatusMessage(issueId: string) {
    const map = JSON.parse(await readFile(ISSUE_MAP_FILE, 'utf-8')) as IssueMap;
    return map[issueId].lastStatus;
}

export async function removeIssue(issueId: string) {
    const map = JSON.parse(await readFile(ISSUE_MAP_FILE, 'utf-8')) as IssueMap;
    delete map[issueId];
    await writeFile(ISSUE_MAP_FILE, JSON.stringify(map));
}

export async function getActiveIssues() {
    return JSON.parse(await readFile(ISSUE_MAP_FILE, 'utf-8')) as IssueMap;
}

export async function getStageCategory(guild: Guild, state: string) {
    const existing = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildCategory && channel.name === state);
    if (existing) return existing;

    return guild.channels.create({
        name: state,
        type: ChannelType.GuildCategory,
    });
}

export async function moveIssueChannelToStage(guild: Guild, channelId: Snowflake, state: string) {
    const [channel, category] = await Promise.all([
        guild.channels.fetch(channelId),
        getStageCategory(guild, state),
    ]);
    if (!channel || channel.isThread() || channel.parentId === category.id) return;
    await channel.setParent(category.id);
}

export function getClosestCircleEmoji(inputHex: number|string) {
    let hex = typeof inputHex === 'number' ? inputHex.toString(16) : inputHex;
    hex = hex.replace('#', '').padStart(6, '0');

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    const circlePalette = [
        { emoji: '🔴', r: 202, g: 63,  b: 73  },
        { emoji: '🟠', r: 229, g: 149, b: 55  },
        { emoji: '🟡', r: 245, g: 204, b: 108  },
        { emoji: '🟢', r: 131, g: 174, b: 98  },
        { emoji: '🔵', r: 107,  g: 160, b: 231 },
        { emoji: '🟣', r: 96, g: 105, b: 203 },
        { emoji: '🟤', r: 181, g: 109, b: 84  },
        { emoji: '⚫', r: 49,  g: 55,  b: 60  },
        { emoji: '⚪', r: 229, g: 230, b: 231 }
    ];

    let closestMatch = circlePalette[0];
    let minDistance = Infinity;

    for (const color of circlePalette) {
        const distance = Math.sqrt(
            Math.pow(r - color.r, 2) +
            Math.pow(g - color.g, 2) +
            Math.pow(b - color.b, 2)
        );

        if (distance < minDistance) {
            minDistance = distance;
            closestMatch = color;
        }
    }

    return closestMatch.emoji;
}

// Fetch everything the bot needs about an issue in one request, rather than the SDK's lazy
// per-relation requests (issue.state, issue.assignee, ...) which each count against the rate limit.
export type IssueSnapshot = Pick<Issue, 'id' | 'identifier' | 'title' | 'description' | 'url' | 'dueDate'>
    & {state?: Pick<WorkflowState, 'id' | 'name' | 'color'> | null, assignee?: {id: string} | null};
const ISSUE_FIELDS = `id identifier title description url dueDate state { id name color } assignee { id }`;

export async function fetchIssue(issueId: string) {
    return (await (await Linear()).client.request<{issue: IssueSnapshot}, {id: string}>(
        `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, {id: issueId})).issue;
}

export async function fetchIssues(issueIds: string[]) {
    const result = new Map<string, IssueSnapshot>();
    let after: string | undefined = undefined;
    do {
        const {issues}: {issues: {nodes: IssueSnapshot[], pageInfo: {hasNextPage: boolean, endCursor?: string}}} =
            await (await Linear()).client.request(`query Issues($ids: [ID!], $after: String) {
                issues(filter: {id: {in: $ids}}, first: 250, after: $after, includeArchived: true) {
                    nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor }
                }
            }`, {ids: issueIds, after});
        for (const issue of issues.nodes) result.set(issue.id, issue);
        after = issues.pageInfo.hasNextPage ? issues.pageInfo.endCursor : undefined;
    } while (after)
    return result;
}

export function branchName(issue: Pick<Issue, 'identifier' | 'title'>) {
    const slug = issue.title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
    return `${issue.identifier}-${slug}`;
}

export async function getOwners(issue: IssueSnapshot, state?: IssueSnapshot['state']) {
    let owners: string[];

    const stateId = state?.id;
    if (stateId === LinearStates['Code Review'] || stateId === LinearStates['Done']) {
        owners = await getUsers(ProjectRoles.CodeReviewer);
    } else if (stateId === LinearStates['QA Ready']) {
        owners = await getUsers(ProjectRoles.QAReviewer);
    } else {
        owners = [await getDiscordUser((await issue.assignee)!.id)];
    }

    return [...new Set(owners)];
}

export async function getStatusMessage(issueOrId: string | IssueSnapshot, assigneeId?: string) {
    const issue = typeof issueOrId === 'string' ? await fetchIssue(issueOrId) : issueOrId;
    const issueId = issue.id;
    const state = (await issue.state)!;
    const stateName = state?.name || 'Unknown';

    const githubUrl = `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/tree/${branchName(issue)}`;
    const compareUrl = `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/compare/${process.env.GITHUB_BASE_BRANCH}...${branchName(issue)}?expand=1`;

    const owners = await getOwners(issue, state);
    const embed = new EmbedBuilder()
        .setTitle(`[${issue.identifier}] ${issue.title}`)
        .setURL(issue.url)
        .setDescription(`${issue.description}\n\n[GitHub Branch](${githubUrl})\n[Linear Issue](${issue.url})`)
        .setColor(Colors.Blurple)
        .addFields(
            {name: 'Status', value: `${getClosestCircleEmoji(state?.color || '#5E6AD2')} ${stateName}`, inline: true},
            {name: 'Due Date', value: issue.dueDate || 'Not set', inline: true},
            {name: 'Owner', value: `<@${await getDiscordUser(assigneeId ?? (await issue.assignee)!.id)}>`, inline: true},
            {name: 'Handler', value: owners.map(user => `<@${user}>`).join(' '), inline: true}
        );

    const linkButtons: ButtonBuilder[] = [
        new ButtonBuilder()
            .setLabel('Linear')
            .setStyle(ButtonStyle.Link)
            .setURL(issue.url),
        new ButtonBuilder()
            .setLabel('GitHub')
            .setStyle(ButtonStyle.Link)
            .setURL(githubUrl),
        new ButtonBuilder()
            .setLabel('Compare')
            .setStyle(ButtonStyle.Link)
            .setURL(compareUrl)
    ];

    const actionButtons: ButtonBuilder[] = [];

    if (state?.id === LinearStates['In Development']) {
        actionButtons.push(
            new ButtonBuilder()
                .setCustomId(`code_review|${issueId}`)
                .setLabel('Code Review')
                .setStyle(ButtonStyle.Success)
        );
    } else if (state?.id === LinearStates['Code Review']) {
        actionButtons.push(
            new ButtonBuilder()
                .setCustomId(`reset_dev|${issueId}`)
                .setLabel('Continue Development')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`qa_review|${issueId}`)
                .setLabel('QA Review')
                .setStyle(ButtonStyle.Success)
        );
    } else if (state?.id === LinearStates['QA Ready']) {
        actionButtons.push(
            new ButtonBuilder()
                .setCustomId(`reset_dev|${issueId}`)
                .setLabel('Continue Development')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`merge|${issueId}`)
                .setLabel('Merge')
                .setStyle(ButtonStyle.Success)
        );
    } else if (state?.id === LinearStates['Done']) {
        actionButtons.push(
            new ButtonBuilder()
                .setCustomId(`merged|${issueId}`)
                .setLabel('Merge Complete')
                .setStyle(ButtonStyle.Success)
        );
    }

    return {embeds: [embed], components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(linkButtons),
            new ActionRowBuilder<ButtonBuilder>().addComponents(actionButtons)]};
}