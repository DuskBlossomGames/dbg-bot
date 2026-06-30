import {
    Client,
    Colors,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    MessageFlags,
    PermissionFlagsBits,
    RepliableInteraction,
    REST,
    Routes,
    SlashCommandBuilder,
    TextChannel
} from 'discord.js';
import * as schedule from 'node-schedule';
import {
    getActiveIssues,
    getOwners,
    getDiscordUser,
    getStatusMessage,
    getUsers,
    ProjectRoles,
    updateStatusMessage
} from "./util";
import {Linear, LinearStates} from "./clients";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

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
                    .setDescription('Move to Done and ping code reviewers to merge.'))
            .addSubcommand(sub =>
                sub.setName('merged')
                    .setDescription('Archive the issue channel and deregister watchers.')),
    ];

    for (const command of commands) {
        const {execute, autocomplete, modals, buttons} = await import(`./commands/${command.name}`);
        client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand() || interaction.commandName !== command.name) return;

            try {
                await execute(interaction);
            } catch (error) {
                console.error(error);
                await sendError(interaction);
            }
        });
        if (autocomplete) {
            client.on(Events.InteractionCreate, async (interaction) => {
                if (!interaction.isAutocomplete() || interaction.commandName !== command.name) return;

                try {
                    await autocomplete(interaction);
                } catch (error) {
                    console.error(error);
                }
            })
        }
        if (modals) {
            client.on(Events.InteractionCreate, async (interaction) => {
                if (!interaction.isModalSubmit()) return;

                for (const regex in modals) {
                    if (!new RegExp(regex).test(interaction.customId)) continue;

                    try {
                        await modals[regex](interaction);
                    } catch (error) {
                        console.error(error);
                        await sendError(interaction);
                    }
                    break;
                }
            })
        }
        if (buttons) {
            client.on(Events.InteractionCreate, async (interaction) => {
                if (!interaction.isButton()) return;

                for (const regex in buttons) {
                    if (!new RegExp(regex).test(interaction.customId)) continue;

                    try {
                        await buttons[regex](interaction);
                    } catch (error) {
                        console.error(error);
                        await sendError(interaction);
                    }
                    break;
                }
            })
        }
    }

    try {
        await rest.put(Routes.applicationCommands(process.env.APP_ID),
            {body: commands.map(command => command.toJSON())});
    } catch (error) {
        console.error(error);
    }

}

// LOGIN
client.once(Events.ClientReady, async (readyClient) => {
    await registerCommands();

    schedule.scheduleJob('* * * * *', async () => {
        for (const [issueId, {channel: channelId, lastStatus}] of Object.entries(await getActiveIssues())) {
            const channel = await readyClient.channels.fetch(channelId);
            if (!channel?.isSendable()) return;

            await channel.messages.edit(lastStatus, await getStatusMessage(issueId));
        }
    })

    schedule.scheduleJob({hour: 8, minute: 0, second: 0, tz: "America/Los_Angeles"}, async () => {
        for (const [issueId, {channel: channelId}] of Object.entries(await getActiveIssues())) {
            const channel = await readyClient.channels.fetch(channelId);
            if (!channel?.isSendable()) return;


            await updateStatusMessage(issueId, (await channel.send(await getStatusMessage(issueId))).id);
        }
    });
    schedule.scheduleJob({hour: 19, minute: 0, second: 0, tz: "America/Los_Angeles"}, async () => {
        for (const [issueId, {channel: channelId}] of Object.entries(await getActiveIssues())) {
            const channel = await readyClient.channels.fetch(channelId);
            if (!channel?.isSendable()) return;

            const issue = await Linear.issue(issueId);
            const owners = await getOwners(issue, await issue.state);

            const messages = await channel.messages.fetch({limit: 100});
            const startOfDayPST = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/Los_Angeles'}));
            startOfDayPST.setHours(0, 0, 0, 0);

            if (messages.some(msg => owners.includes(msg.author.id) &&
                new Date(new Date(msg.createdTimestamp)
                    .toLocaleString('en-US', {timeZone: 'America/Los_Angeles'})) >= startOfDayPST)) continue;

            const ownerMentions = owners.map(user => `<@${user}>`).join(' ');
            const embed = new EmbedBuilder()
                .setTitle("📋 Daily Status Update Reminder")
                .setDescription(`Please send a status update if nothing else has happened today.`)
                .setColor(Colors.Red);

            await channel.send({
                content: ownerMentions,
                embeds: [embed]
            });

        }
    })
});

client.login(process.env.DISCORD_TOKEN);