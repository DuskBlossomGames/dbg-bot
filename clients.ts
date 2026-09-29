import {LinearClient, LinearErrorRaw, LinearGraphQLClient, parseLinearError, RatelimitedLinearError} from "@linear/sdk";
import {Octokit} from "octokit";
import { createAppAuth } from "@octokit/auth-app"
import {readFile, writeFile} from "node:fs/promises";
import {existsSync, writeFileSync, readFileSync} from "node:fs";
import {ChannelType, Client, GuildBasedChannel} from "discord.js";
import * as schedule from 'node-schedule';

interface TokenStorage {
    refreshToken: string;
    expiresAt: number;
}
// const DEFAULT_TOKENS: TokenStorage = { refreshToken: process.env.LINEAR_REFRESH_TOKEN!, expiresAt: 0 };

const LINEAR_TOKENS_FILE = "linear_tokens.json";
if (!existsSync(LINEAR_TOKENS_FILE)) writeFileSync(LINEAR_TOKENS_FILE, '{}');

const tokens = async () =>
    JSON.parse(await readFile(LINEAR_TOKENS_FILE, 'utf-8')) as TokenStorage;
const writeTokens = async (tokens: TokenStorage) =>
    await writeFile(LINEAR_TOKENS_FILE, JSON.stringify(tokens));

export async function linearOauth(token: string) {
    const payload = new URLSearchParams();
    payload.append('code', token);
    payload.append('redirect_uri', 'http://localhost');
    payload.append('client_id', process.env.LINEAR_CLIENT_ID!);
    payload.append('client_secret', process.env.LINEAR_CLIENT_SECRET!);
    payload.append('grant_type', 'authorization_code');

    const resp = await (await fetch('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payload
    })).json();

    await writeTokens({
        refreshToken: resp.refresh_token,
        expiresAt: Date.now() + resp.expires_in * 1000,
    });

    client = new LinearClient({
        accessToken: resp.access_token,
    });
}

async function refreshTokens() {
    const response = await fetch("https://api.linear.app/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: process.env.LINEAR_CLIENT_ID!,
            client_secret: process.env.LINEAR_CLIENT_SECRET!,
            refresh_token: (await tokens()).refreshToken,
        }),
    });

    if (!response.ok) {
        await botLog(`<@501212640392118272> failed to refresh Linear token: ${response.statusText}`);
    }

    const data = await response.json();

    await writeTokens({
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
    });

    client = new LinearClient({
        accessToken: data.access_token,
    });
}

let discord: Client<true> | null = null
export function discordReady(d: Client<true>) { discord = d; }

async function botLog(message: string) {
    const channel = discord!.channels.cache.find(channel =>
        channel.type === ChannelType.GuildText && channel.name === "bot-log")!;
    if (channel.isSendable()) await channel.send(message);
}

// On a rate limit, log out of Discord and wait out Linear's window before exiting, so the container restarts once
// the limit has cleared instead of crash-looping (and burning Discord logins) while Linear is still rejecting requests.
let rateLimitError: RatelimitedLinearError | null = null;
async function handleRateLimit(error: RatelimitedLinearError) {
    if (rateLimitError) return;
    rateLimitError = error;

    const now = Date.now(), hour = 60 * 60 * 1000;
    const exhausted = [
        error.requestsRemaining === 0 ? error.requestsResetAt : undefined,
        error.complexityRemaining === 0 ? error.complexityResetAt : undefined,
    ].filter((reset): reset is number => !!reset && reset > now);
    const resetAt = exhausted.length ? Math.max(...exhausted)
        : error.retryAfter ? now + error.retryAfter * 1000
        : error.requestsResetAt && error.requestsResetAt > now ? error.requestsResetAt
        : now + hour;
    const wait = Math.min(resetAt - now, hour) + 30 * 1000;

    console.error(`Linear rate limited, restarting in ${Math.round(wait / 1000)}s`, error);
    await botLog(`<@501212640392118272> Linear rate limit hit ` +
        `(requests: ${error.requestsRemaining ?? '?'}/${error.requestsLimit ?? '?'} remaining, ` +
        `complexity: ${error.complexityRemaining ?? '?'}/${error.complexityLimit ?? '?'} remaining). ` +
        `Shutting down and restarting <t:${Math.floor((now + wait) / 1000)}:R>.`).catch(console.error);

    // In-flight handlers may fail once Discord is gone; don't let that end the wait early.
    process.on('unhandledRejection', error => console.error(error));
    process.on('uncaughtException', error => console.error(error));
    setTimeout(() => process.exit(1), wait);

    for (const job of Object.values(schedule.scheduledJobs)) job.cancel();
    await discord?.destroy().catch(console.error);
}

const request = LinearGraphQLClient.prototype.request;
LinearGraphQLClient.prototype.request = async function (this: LinearGraphQLClient, ...args: Parameters<typeof request>) {
    if (rateLimitError) throw rateLimitError;
    try {
        return await request.apply(this, args);
    } catch (error) {
        const parsed = parseLinearError(error as LinearErrorRaw);
        if (parsed instanceof RatelimitedLinearError) await handleRateLimit(parsed);
        throw error;
    }
} as typeof request;

let client: LinearClient | null = null;
export async function Linear(): Promise<LinearClient> {
    const buffer = 5 * 60 * 1000;
    if (Date.now() + buffer >= (await tokens()).expiresAt || !client) await refreshTokens();
    return client!;
}
export const LinearStates = {
    'Code Review': 'f8cafa5c-7680-4aeb-8f5d-5b1d1191403f',
    'QA Ready': 'd9cdffd6-c06d-47e4-baab-3abc211c0d56',
    'Canceled': 'a68e1335-5db6-4855-95eb-c5954639e0cb',
    'Done': '91096a8b-1f23-493e-a23c-c23d37bb8479',
    'In Development': '8683122a-dee1-455d-b771-dff3e6c761fd',
    'Todo': '5f01fbee-f353-4dd9-9a81-6caae4df336e',
    'Backlog': '3ea0356e-0f46-4fbe-82c5-5d57a4fc0aee',
    'Duplicate': '088670fe-3f12-4495-9ed2-8530ece1bc6c'
};

export const GitHub = new Octokit({
    authStrategy: createAppAuth,
    auth: {
        appId: process.env.GITHUB_APP_ID,
        privateKey: process.env.GITHUB_PRIVATE_KEY,
        installationId: process.env.GITHUB_INSTALLATION_ID,
    },
});
