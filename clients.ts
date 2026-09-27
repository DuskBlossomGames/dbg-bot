import {LinearClient} from "@linear/sdk";
import {Octokit} from "octokit";
import { createAppAuth } from "@octokit/auth-app"
import {readFile, writeFile} from "node:fs/promises";
import {existsSync, writeFileSync, readFileSync} from "node:fs";
import {ChannelType, Client, GuildBasedChannel} from "discord.js";

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
        const error = `<@501212640392118272> failed to refresh Linear token: ${response.statusText}`;
        const channel = discord!.channels.cache.find(channel =>
            channel.type === ChannelType.GuildText && channel.name === "bot-log")!;
        if (channel.isSendable()) await channel.send(error);
        throw new Error(error);
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
