import {Snowflake} from "discord.js";
import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync, existsSync } from 'node:fs'

export enum ProjectRoles { CodeReviewer = "Code Reviewer", QAReviewer = "QA Reviewer" }
export type UserData = {linear: string, roles: ProjectRoles[]}
type UserMap = {[idx: Snowflake]: UserData}

const USER_MAP_FILE = "usermap.json"
if (!existsSync(USER_MAP_FILE)) writeFileSync(USER_MAP_FILE, '{}')

export async function registerUser(discord: Snowflake, linear: string, roles: ProjectRoles[]) {
    const map = JSON.parse(await readFile(USER_MAP_FILE, 'utf-8')) as UserMap;
    map[discord] = {linear, roles};
    await writeFile(USER_MAP_FILE, JSON.stringify(map));
}

export async function getLinearUser(discord: Snowflake) {
    return JSON.parse(await readFile(USER_MAP_FILE, 'utf-8'))[discord]?.linear;
}

export async function getUsers(role: ProjectRoles) {
    const map = JSON.parse(await readFile(USER_MAP_FILE, 'utf-8')) as UserMap;

    return Object.keys(map).filter(k=>map[k].roles.includes(role))
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
        { emoji: '🟣', r: 164, g: 142, b: 209 },
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