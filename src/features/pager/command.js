// Node Modules
import { SlashCommandBuilder, EmbedBuilder, InteractionContextType } from "discord.js";

// Config & Errors
import { game } from "#config";
import { ConfigError, ValidationError } from "#src/errors";

// Command
export default {
  data: new SlashCommandBuilder()
    .setName("pager")
    .setDescription("Used to send out a pager.")
    .addStringOption(option =>
      option
        .setName("type")
        .setDescription("Which pager would you like to trigger?")
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName("content")
        .setDescription("What do you want the pager to say?")
        .setRequired(true),
    )
    .setContexts(InteractionContextType.Guild),
  async execute(i) {
    const pager = i.options.getString("type");
    const settings = i.client.settings.get(i.guild);
    const pagerTypes = Array.from(settings.pagers?.keys?.() ?? []);
    if (pagerTypes.length === 0)
      throw new ConfigError("No pagers have been configured for this server.");

    if (!settings.pagers?.get(pager.toLowerCase()))
      throw new ValidationError(
        `\`${pager.toLowerCase()}\` is not a valid pager, please choose one of the following: \`${pagerTypes.join(", ")}\`.`,
      );

    const pInfo = settings.pagers?.get(pager.toLowerCase());
    const channel = await i.guild.channels.fetch(pInfo.channel).catch(() => null);

    if (!channel)
      throw new ConfigError(`The channel for the \`${pager}\` pager is invalid or inaccessible.`);

    const embed = new EmbedBuilder()
      .setTitle("Pager")
      .setDescription(
        `**${i.member.displayName}** has requested **\`${pager.toUpperCase()}\`**.
    \`\`\`${i.options.getString("content")}\`\`\``,
      )
      .setColor(settings.color);

    embed.addFields({
      name: "Profile Link",
      value: `[${i.member.displayName}](https://www.roblox.com/user.aspx?username=${i.member.displayName})`,
    });

    if (game.name && game.id) {
      embed.addFields({
        name: "Game Link",
        value: `[${game.name}](https://www.roblox.com/games/${game.id})`,
      });
    }

    try {
      await channel.send({ content: `<@&${pInfo.role}>`, embeds: [embed] });
    } catch {
      throw new ConfigError(
        `Your pager has not been sent. Cannot send messages in \`${pager}\` pager channel.`,
      );
    }

    await i.editReply("Pager sent.");
  },
};
