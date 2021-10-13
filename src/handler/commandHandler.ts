/**
 * Completly new bullish command handler it unifies slash commands and
 * message commands and relies on the "new commands"
 */

import { InfoCommand } from "../commands/info";
import { getConfig } from "../utils/configHandler";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import { Client, CommandInteraction, Interaction, Message } from "discord.js";
import { isMod } from "../utils/securityUtils";
import {
    ApplicationCommand,
    Command,
    isApplicationCommand,
    isMessageCommand,
    isSpecialCommand,
    MessageCommand,
    SpecialCommand,
} from "../commands/command";
import { YepYepCommand } from "../commands/special/yepyep";
import { NixOsCommand } from "../commands/special/nixos";
import { WhereCommand } from "../commands/special/where";
import { DadJokeCommand } from "../commands/special/dadJoke";
import { WatCommand } from "../commands/special/wat";
import * as log from "../utils/logger";
import { StempelCommand } from "../commands/stempeln";

const config = getConfig();

let lastSpecialCommand = 0;

export const commands: Array<Command> = [
    new InfoCommand(),
    new YepYepCommand(),
    new NixOsCommand(),
    new WhereCommand(),
    new DadJokeCommand(),
    new WatCommand(),
    new StempelCommand()
];
export const applicationCommands: Array<ApplicationCommand> =
    commands.filter<ApplicationCommand>(isApplicationCommand);
export const messageCommands: Array<MessageCommand> =
    commands.filter<MessageCommand>(isMessageCommand);
export const specialCommands: Array<SpecialCommand> =
    commands.filter<SpecialCommand>(isSpecialCommand);

/**
 * Registers all defined applicationCommands as guild commands
 * We're overwriting ALL, therefore no deletion is necessary
 */
export const registerAllApplicationCommandsAsGuildCommands = async () => {
    const guildId = config.ids.guild_id;
    const clientId = config.auth.client_id;
    const token = config.auth.bot_token;

    const rest = new REST({ version: "9" }).setToken(token);

    const commandData = applicationCommands.map((cmd) =>
        cmd.applicationCommand.toJSON()
    );

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commandData,
    });
};

/**
 * Handles command interactions.
 * @param command the recieved command interaction
 * @param client client
 * @returns the handled command or an error if no matching command was found.
 */
const commandInteractionHandler = async (
    command: CommandInteraction,
    client: Client
) => {
    const matchingCommand = applicationCommands.find(
        (cmd) => cmd.name === command.commandName
    );
    if (matchingCommand) {
        return matchingCommand.handleInteraction(command, client);
    } else {
        throw new Error(
            `Application Command ${command.commandName} with ID ${command.id} invoked, but not availabe`
        );
    }
};

/**
 * handles message commands
 * @param commandString the sliced command (e.g. "info")
 * @param message the message which invoked the command
 * @param client client
 * @returns handled message command or nothing if no matching command
 * was found or an error if the command would be a mod command but the
 * invoking user is not a mod
 */
const commandMessageHandler = async (
    commandString: String,
    message: Message,
    client: Client
) => {
    const matchingCommand = messageCommands.find(
        (cmd) => cmd.name === commandString
    );
    if (matchingCommand) {
        if (matchingCommand.modCommand) {
            const member = message.guild?.members.cache.get(message.author.id);
            if (!member || !isMod(member)) {
                throw new Error(`Not a mod`);
            }
        }
        return matchingCommand.handleMessage(message, client);
    }
    return;
};

const isCooledDown = () => {
    const now = Date.now();
    const diff = now - lastSpecialCommand;
    const fixedCooldown = 120000;
    // After 2 minutes command is cooled down
    if (diff >= fixedCooldown) {
        return true;
    }
    // Otherwise a random function should evaluate the cooldown. The longer the last command was, the higher the chance
    // diff is < fixedCooldown
    return Math.random() < diff / fixedCooldown;
};

const specialCommandHandler = async (message: Message, client: Client) => {
    const commandCandidates = specialCommands.filter((p) =>
        p.pattern.test(message.content)
    );

    if (
        commandCandidates.length > 0 &&
        (isCooledDown() || (message.member && isMod(message.member)))
    ) {
        return Promise.all(
            commandCandidates
                .filter((c) => Math.random() <= c.randomness)
                .map((c) => {
                    log.info(
                        `User "${message.author.tag}" (${message.author}) performed special command: ${c.name}`
                    );
                    lastSpecialCommand = Date.now();
                    return c.handleSpecialMessage(message, client);
                })
        );
    }
    return;
};

export const handleInteractionEvent = async (
    interaction: Interaction,
    client: Client
) => {
    if (interaction.isCommand()) {
        return commandInteractionHandler(
            interaction as CommandInteraction,
            client
        );
    }
};

export const messageCommandHandler = async (
    message: Message,
    client: Client
) => {
    // TODO: The Prefix is now completly irrelevant, since the commands itself define
    // their permisson.
    const plebPrefix = config.bot_settings.prefix.command_prefix;
    const modPrefix = config.bot_settings.prefix.mod_prefix;
    if (
        message.content.startsWith(plebPrefix) ||
        message.content.startsWith(modPrefix)
    ) {
        const cmdString = message.content.split(/\s+/)[0].slice(1);
        if (cmdString) {
            return commandMessageHandler(cmdString, message, client);
        }
        return;
    } else {
        return specialCommandHandler(message, client);
    }
};