import {Snowflake, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, Colors} from "discord.js";
import {readFile, writeFile} from "node:fs/promises";
import {writeFileSync, existsSync} from 'node:fs'
import {Linear, LinearStates} from "./clients";
import {Issue} from "@linear/sdk";

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
    map[discord] = {linear, roles: roles.map(r=>ProjectRoles[r])};
    await writeFile(USER_MAP_FILE, JSON.stringify(map));
}

export async function getLinearUser(discord: Snowflake) {
    return JSON.parse(await readFile(USER_MAP_FILE, 'utf-8'))[discord]?.linear;
}

export async function getDiscordUser(linear: string) {
    const map = JSON.parse(await readFile(USER_MAP_FILE, 'utf-8')) as UserMap;
    return Object.keys(map).find(key=>map[key].linear === linear);
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

export function branchName(issue: Issue) {
    const slug = issue.title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
    return `${issue.identifier}-${slug}`;
}

export async function getStatusMessage(issueId: string) {
    const issue = await Linear.issue(issueId);
    const state = await issue.state;
    const stateName = state?.name || 'Unknown';

    const githubUrl = `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/tree/${branchName(issue)}`;

    const embed = new EmbedBuilder()
        .setTitle(`[${issue.identifier}] ${issue.title}`)
        .setURL(issue.url)
        .setDescription(`${issue.description}\n\n[GitHub Branch](${githubUrl})\n[Linear Issue](${issue.url})`)
        .setColor(Colors.Blurple)
        .addFields(
            {name: 'Status', value: `${getClosestCircleEmoji(state?.color || '#5E6AD2')} ${stateName}`, inline: true},
            {name: 'Due Date', value: issue.dueDate || 'Not set', inline: true},
            {name: 'Owner', value: `<@${await getDiscordUser((await issue.assignee).id)}>`}
        );

    const linkButtons: ButtonBuilder[] = [
        new ButtonBuilder()
            .setLabel('Linear')
            .setStyle(ButtonStyle.Link)
            .setURL(issue.url),
        new ButtonBuilder()
            .setLabel('GitHub')
            .setStyle(ButtonStyle.Link)
            .setURL(githubUrl)
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