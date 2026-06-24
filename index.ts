import {
    Client,
    Routes,
    Events,
    GatewayIntentBits,
    MessageFlags,
    REST,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder, Colors, SlashCommandStringOption, Interaction, CacheType, RepliableInteraction, SlashCommandUserOption
} from 'discord.js';
import {Linear} from "./clients";

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
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
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
});

client.login(process.env.DISCORD_TOKEN);