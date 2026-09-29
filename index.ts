import {
    AutocompleteInteraction, ButtonInteraction,
    Client, Collection,
    Colors, CommandInteraction,
    EmbedBuilder,
    Events,
    GatewayIntentBits, Message,
    MessageFlags, ModalSubmitInteraction,
    PermissionFlagsBits,
    RepliableInteraction,
    REST,
    Routes, SendableChannels,
    SlashCommandBuilder,
} from 'discord.js';
import * as schedule from 'node-schedule';
import {
    fetchIssue,
    fetchIssues,
    getActiveIssues,
    getOwners,
    getStatusMessage,
    moveIssueChannelToStage,
    updateStatusMessage
} from "./util";
import {discordReady, Linear, LinearStates} from "./clients";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

// REGISTER COMMANDS
async function sendError(interaction: RepliableInteraction) {
    const embed = new EmbedBuilder()
        .setTitle("🚨 Error")
        .setColor(Colors.DarkRed)
        .setDescription("There was an error while executing this command!");
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
        });
    } else {
        await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
        });
    }
}

export async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName("help")
            .setDescription("Help command."),
        new SlashCommandBuilder()
            .setName("issue")
            .setDescription("Creates a Linear issue."),
        new SlashCommandBuilder()
            .setName("linear")
            .setDescription("Complete Linear OAuth."),
        new SlashCommandBuilder()
            .setName('link')
            .setDescription("Link a Discord user to a Linear user and apply roles.")
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
        new SlashCommandBuilder()
            .setName('assign')
            .setDescription("Assign a Linear issue, create a branch, and open a Discord channel.")
            .addStringOption(option =>
                option.setName('issue')
                    .setDescription('The Linear issue to assign.')
                    .setRequired(true)
                    .setAutocomplete(true))
            .addUserOption(option =>
                option.setName('owner')
                    .setDescription('The Discord user who will own this issue.')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('due_date')
                    .setDescription('When the issue is due (YYYY-MM-DD).')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Manage issue workflow status.')
            .addSubcommand(sub =>
                sub.setName('continue-dev')
                    .setDescription('Move back to In Development and ping the owner.'))
            .addSubcommand(sub =>
                sub.setName('code-review')
                    .setDescription('Move to Code Review and ping code reviewers.'))
            .addSubcommand(sub =>
                sub.setName('qa-review')
                    .setDescription('Move to QA Ready and ping QA reviewers.'))
            .addSubcommand(sub =>
                sub.setName('qa-accept')
                    .setDescription('Move to Merge Ready and ping code reviewers to merge.'))
            .addSubcommand(sub =>
                sub.setName('merged')
                    .setDescription('Move to Done and deregister watchers.')),
    ];

    const executes: {[command: string]: (i: CommandInteraction) => Promise<void>} = {};
    const autocompletes: {[command: string]: (i: AutocompleteInteraction) => Promise<void>} = {};
    const all_modals: {[modal: string]: (i: ModalSubmitInteraction) => Promise<void>} = {};
    const all_buttons: {[button: string]: (i: ButtonInteraction) => Promise<void>} = {};

    for (const command of commands) {
        const {execute, autocomplete, modals, buttons} = await import(`./commands/${command.name}`);
        executes[command.name] = execute;
        if (autocomplete) autocompletes[command.name] = autocomplete;
        if (modals) for (const regex in modals) { all_modals[regex] = modals[regex]; }
        if (buttons) for (const regex in buttons) { all_buttons[regex] = buttons[regex]; }
    }

    client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isChatInputCommand()) {
            if (!(interaction.commandName in executes)) return;

            try {
                await executes[interaction.commandName](interaction);
            } catch (error) {
                console.error(error);
                await sendError(interaction);
            }
        } else if (interaction.isAutocomplete()) {
            if (!(interaction.commandName in autocompletes)) return;

            try {
                await autocompletes[interaction.commandName](interaction);
            } catch (error) {
                console.error(error);
            }
        } else if (interaction.isModalSubmit()) {
            for (const regex in all_modals) {
                if (!new RegExp(regex).test(interaction.customId)) continue;

                try {
                    await all_modals[regex](interaction);
                } catch (error) {
                    console.error(error);
                    await sendError(interaction);
                }
                break;
            }
        } else if (interaction.isButton()) {
            for (const regex in all_buttons) {
                if (!new RegExp(regex).test(interaction.customId)) continue;

                try {
                    await all_buttons[regex](interaction);
                } catch (error) {
                    console.error(error);
                    await sendError(interaction);
                }
                break;
            }
        }
    });

    try {
        await rest.put(Routes.applicationCommands(process.env.APP_ID!),
            {body: commands.map(command => command.toJSON())});
    } catch (error) {
        console.error(error);
    }

}

async function hasOwnerMessageSince(channel: SendableChannels, ownerIds: string[], cutoff: number) {
    let before = undefined;
    while (true) {
        const messages: Collection<string, Message<boolean>> = await channel.messages.fetch({limit: 100, before});
        if (messages.some(message =>
            ownerIds.includes(message.author.id) && message.createdTimestamp >= cutoff)) return true;

        if (messages.size < 100) return false;
        const oldest = messages.reduce((current, message) =>
            message.createdTimestamp < current.createdTimestamp ? message : current);
        if (oldest.createdTimestamp < cutoff) return false;
        before = oldest.id;
    }
}

function reminderEmbeds(lines: string[]) {
    const descriptions: string[] = [];
    for (const line of lines) {
        const current = descriptions.at(-1);
        if (!current || current.length + line.length + 1 > 3800) {
            descriptions.push(line);
        } else {
            descriptions[descriptions.length - 1] += `\n${line}`;
        }
    }

    return descriptions.slice(0, 10).map((description, index) =>
        new EmbedBuilder()
            .setTitle(index === 0 ? "📋 Stale Issue Reminder" : null)
            .setDescription(description)
            .setColor(Colors.Red));
}

// LOGIN
client.once(Events.ClientReady, async (readyClient) => {
    discordReady(readyClient);

    await registerCommands();
    console.log("Registered commands");

    const renderedStatus = new Map<string, string>();
    schedule.scheduleJob('* * * * *', async () => {
        const issues = await fetchIssues(Object.keys(await getActiveIssues()));
        for (const [issueId, {channel: channelId, lastStatus}] of Object.entries(await getActiveIssues())) {
            const channel = await readyClient.channels.fetch(channelId).catch(() => null);
            if (!channel?.isSendable()) continue;

            const state = issues.get(issueId)?.state;
            if (state && !channel.isDMBased()) {
                let s = state.name;
                if (s == "Done") s = "Merge Ready";
                moveIssueChannelToStage(channel.guild, channel.id, s);
            }

            if (!lastStatus) continue;
            const status = await getStatusMessage(issues.get(issueId) ?? issueId);
            if (renderedStatus.get(lastStatus) === JSON.stringify(status)) continue;
            await channel.messages.edit(lastStatus, status);
            renderedStatus.set(lastStatus, JSON.stringify(status));
        }
    })

    schedule.scheduleJob({hour: 8, minute: 0, second: 0, tz: "America/Los_Angeles"}, async () => {
        const issues = await fetchIssues(Object.keys(await getActiveIssues()));
        for (const [issueId, {channel: channelId, lastStatus}] of Object.entries(await getActiveIssues())) {
            const channel = await readyClient.channels.fetch(channelId).catch(() => null);
            if (!channel?.isSendable()) continue;

            const messages = await channel.messages.fetch({limit: 20});
            if (messages.some(msg=>msg.id === lastStatus)) continue;

            await updateStatusMessage(issueId, (await channel.send(await getStatusMessage(issues.get(issueId) ?? issueId))).id);
        }
    });
    schedule.scheduleJob({hour: 19, minute: 0, second: 0, tz: "America/Los_Angeles"}, async () => {
        const reminders = new Map<string, string[]>();
        const cutoff = Date.now() - 48 * 60 * 60 * 1000;

        const issues = await fetchIssues(Object.keys(await getActiveIssues()));
        for (const [issueId, {channel: channelId}] of Object.entries(await getActiveIssues())) {
            const channel = await readyClient.channels.fetch(channelId).catch(() => null);
            if (!channel?.isSendable()) continue;

            const issue = issues.get(issueId) ?? await fetchIssue(issueId);
            const owners = await getOwners(issue, (await issue.state)!);
            if (!owners.length || await hasOwnerMessageSince(channel, owners, cutoff)) continue;

            for (const ownerId of owners) {
                const ownerReminders = reminders.get(ownerId) ?? [];
                ownerReminders.push(`* [[${issue.identifier}] ${issue.title}](${issue.url})\n  * <#${channel.id}>`);
                reminders.set(ownerId, ownerReminders);
            }
        }

        for (const [ownerId, issues] of reminders) {
            try {
                const user = await readyClient.users.fetch(ownerId);
                await user.send({
                    content: "These issues are waiting on you and have had no update from their current handlers in the last 48 hours:",
                    embeds: reminderEmbeds(issues),
                });
            } catch (error) {
                console.error(`Could not DM stale issue reminders to Discord user ${ownerId}:`, error);
            }
        }
    })
});

client.login(process.env.DISCORD_TOKEN);