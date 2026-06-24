import {LinearClient} from "@linear/sdk";
import {Octokit} from "octokit";
import { createAppAuth } from "@octokit/auth-app"
import {getClosestCircleEmoji} from "./util";

export const Linear = new LinearClient({accessToken: process.env.LINEAR_TOKEN});
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
