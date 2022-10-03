import {
    CommandInteraction,
    Client,
    GuildMember,
    User,
    CacheType,
    ActionRowBuilder, ButtonBuilder, MessageComponentInteraction, ButtonStyle,
    SlashCommandBuilder,
    SlashCommandStringOption,
    SlashCommandSubcommandBuilder,
    SlashCommandUserOption
} from "discord.js";

import { ApplicationCommand, CommandResult, UserInteraction } from "./command.js";
import Nicknames from "../storage/model/Nickname.js";
import { isTrusted } from "../utils/userUtils.js";


type Vote = "YES" | "NO";

interface UserVote {
    readonly vote: Vote;
    readonly trusted: boolean;

}

function getWeightOfUserVote(vote: UserVote): number {
    return vote.trusted ? 2 : 1;
}

interface Suggestion {
    readonly nicknameUserID: string;
    readonly nickname: string;

}

const ongoingSuggestions: Record<string, Suggestion> = {};
const idVoteMap: Record<string, Record<string, UserVote>> = {};

const getUserVoteMap = (messageid: string): Record<string, UserVote> => {
    if (idVoteMap[messageid] === undefined) {
        idVoteMap[messageid] = {};
    }
    return idVoteMap[messageid];
};

export class Nickname implements ApplicationCommand {
    modCommand: boolean = false;
    name: string = "nickname";
    description: string = "Setzt Nicknames für einen User";

    get applicationCommand(): Pick<SlashCommandBuilder, "toJSON"> {
        return new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .addSubcommand(
                new SlashCommandSubcommandBuilder()
                    .setName("add")
                    .setDescription("Fügt einen nickname hinzu brudi")
                    .addUserOption(
                        new SlashCommandUserOption()
                            .setRequired(true)
                            .setName("user")
                            .setDescription("Wem du tun willst")
                    )
                    .addStringOption(
                        new SlashCommandStringOption()
                            .setRequired(true)
                            .setName("nickname")
                            .setDescription("Was du tun willst")
                    )
            )
            .addSubcommand(
                new SlashCommandSubcommandBuilder()
                    .setName("delete")
                    .setDescription("Entfernt einen Nickname brudi")
                    .addUserOption(
                        new SlashCommandUserOption()
                            .setRequired(true)
                            .setName("user")
                            .setDescription("Wem du tun willst")
                    )
                    .addStringOption(
                        new SlashCommandStringOption()
                            .setRequired(true)
                            .setName("nickname")
                            .setDescription("Was du tun willst")
                    )
            )
            .addSubcommand(
                new SlashCommandSubcommandBuilder()
                    .setName("deleteall")
                    .setDescription("Entfernt alle nicknames brudi")
                    .addUserOption(
                        new SlashCommandUserOption()
                            .setRequired(true)
                            .setName("user")
                            .setDescription("Wem du tun willst")
                    )
            )
            .addSubcommand(
                new SlashCommandSubcommandBuilder()
                    .setName("list")
                    .setDescription("Zeigt alle nicknames brudi")
                    .addUserOption(
                        new SlashCommandUserOption()
                            .setRequired(true)
                            .setName("user")
                            .setDescription("Wem du tun willst")
                    )
            );
    }

    async handleInteraction(command: CommandInteraction, client: Client<boolean>): Promise<CommandResult> {
        if (!command.isChatInputCommand()) {
            // TODO: Solve this on a type level
            return;
        }

        try {
            const option = command.options.getSubcommand();
            const commandUser = command.guild?.members.cache.find(m => m.id === command.user.id)!;
            // We know that the user option is in every subcommand.
            const user = command.options.getUser("user", true);
            const trusted = isTrusted(commandUser);
            const sameuser = user.id === commandUser.user.id;


            // Yes, we could use a switch-statement here. No, that wouldn't make the code more readable as we're than
            // struggling with the nickname parameter which is mandatory only in "add" and "delete" commands.
            // Yes, we could rearrange the code parts into separate functions. Feel free to do so.
            // Yes, "else" is uneccessary as we're returning in every block. However, I find the semantics more clear.
            if (option === "deleteall") {
                if (!trusted && !sameuser) {
                    await command.reply("Hurensohn. Der Command ist nix für dich.");
                    return;
                }
                const member = command.guild?.members.cache.get(user.id);
                await Nicknames.deleteNickNames(user.id);
                await this.updateNickName(member!, null);
                await command.reply("Ok Brudi. Hab alles gelöscht");
                return;
            }
            else if (option === "list") {
                const nicknames = await Nicknames.getNicknames(user.id);
                if (nicknames.length === 0) {
                    await command.reply("Ne Brudi für den hab ich keine Nicknames");
                    return;
                }
                await command.reply(`Hab für den Brudi folgende Nicknames:\n${nicknames.map(n => n.nickName).join(", ")}`);
                return;
            }
            else if (option === "add") {
                if (!trusted) {
                    await command.reply("Hurensohn. Der Command ist nix für dich.");
                    return;
                }
                const nickname = command.options.getString("nickname", true);
                if (await Nicknames.nickNameExist(user.id, nickname)) {
                    await command.reply(`Würdest du Hurensohn aufpassen, wüsstest du, dass für ${user} '${nickname}' bereits existiert.`);
                    return;
                }
                return Nickname.createNickNameVote(command, user, nickname);
                //    await this.addNickname(command, user);
            }
            else if (option === "delete") {
                if (!trusted && !sameuser) {
                    await command.reply("Hurensohn. Der Command ist nix für dich.");
                    return;
                }
                // We don't violate the DRY principle, since we're referring to another subcommand object as in the "add" subcommand.
                // Code is equal but knowledge differs.
                const nickname = command.options.getString("nickname", true);
                await Nicknames.deleteNickName(user.id, nickname);
                const member = command.guild?.members.cache.get(user.id)!;
                if (member.nickname === nickname) {
                    await this.updateNickName(member, null);
                }
                await command.reply(`Ok Brudi. Hab für ${user} ${nickname} gelöscht`);
                return;
            }

            await command.reply("Das hätte nie passieren dürfen");
            return;
        }
        catch (e) {
            console.log(e);
            await command.reply("Das hätte nie passieren dürfen");
            return;
        }
    }

    private static async createNickNameVote(command: CommandInteraction<CacheType>, user: User, nickname: string) {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId("nicknameVoteYes")
                    .setLabel("Guter")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("nicknameVoteNo")
                    .setLabel("Lass ma")
                    .setStyle(ButtonStyle.Danger)
            );
        await command.reply({
            content: `Eh Brudis, soll ich für ${user} ${nickname} hinzufügen?`,
            components: [row]
        });
        const message = await command.fetchReply();
        ongoingSuggestions[message.id] = { nicknameUserID: user.id, nickname };
        getUserVoteMap(message.id)[user.id] = {
            vote: "YES",
            trusted: isTrusted(command.guild?.members.cache.get(user.id)!)
        };
        return;
    }


    async updateNickName(user: GuildMember, nickname: string | null) {
        await user.setNickname(nickname);
    }
}


export class NicknameButtonHandler implements UserInteraction {
    readonly ids = ["nicknameVoteYes", "nicknameVoteNo"];
    readonly name = "NicknameButtonhandler";
    readonly threshold = 7;


    async handleInteraction(interaction: MessageComponentInteraction, client: Client): Promise<void> {
        const suggestion = ongoingSuggestions[interaction.message.id];

        if (suggestion === undefined) {
            await interaction.update({
                content: "Ich find den Namensvorschlag nicht. Irgend ein Huso muss wohl den Bot neugestartet haben. Macht am besten ne Neue auf",
                components: []
            });
            return;
        }
        const userVoteMap = getUserVoteMap(interaction.message.id);

        const istrusted = isTrusted(interaction.guild?.members.cache.get(interaction.user.id)!);
        if (interaction.customId === "nicknameVoteYes") {
            userVoteMap[interaction.user.id] = { vote: "YES", trusted: istrusted };
        }
        else if (interaction.customId === "nicknameVoteNo") {
            userVoteMap[interaction.user.id] = { vote: "NO", trusted: istrusted };
        }
        // evaluate the Uservotes
        const votes: UserVote[] = Object.values(userVoteMap);
        if (this.hasEnoughVotes(votes, "NO")) {
            await interaction.update({
                content: `Der Vorschlag: \`${suggestion.nickname}\` für <@${suggestion.nicknameUserID}> war echt nicht so geil`,
                components: []
            });
            return;
        }
        if (this.hasEnoughVotes(votes, "YES")) {
            try {
                await Nicknames.insertNickname(suggestion.nicknameUserID, suggestion.nickname);
            }
            catch (error) {
                await interaction.update(`Würdet ihr Hurensöhne aufpassen, wüsstest ihr, dass für <@${suggestion.nicknameUserID}> \`${suggestion.nickname}\` bereits existiert.`);
                return;
            }

            await interaction.update({
                content: `Für <@${suggestion.nicknameUserID}> ist jetzt \`${suggestion.nickname}\` in der Rotation`,
                components: []
            });
            return;
        }
        await interaction.reply({ content: "Hast abgestimmt", ephemeral: true });
    }

    private hasEnoughVotes(votes: UserVote[], voteType: Vote) {
        return votes.filter(vote => vote.vote === voteType).reduce((sum, uservote) => sum + getWeightOfUserVote(uservote), 0) >= this.threshold;
    }
}


