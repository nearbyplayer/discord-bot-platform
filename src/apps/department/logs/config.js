import { ChannelType, SlashCommandSubcommandBuilder } from "discord.js";

/**
 * Logs configuration fragment. The base `/config` assembler appends this
 * subcommand and routes `/config logs` here - the base never names logs.
 */
export default {
  subcommand: new SlashCommandSubcommandBuilder()
    .setName("logs")
    .setDescription("Configure the log cycle reset channel.")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel where log cycle resets will be posted.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    ),
  async execute(i) {
    if (!i.client.settings.has(i.guild)) {
      await i.editReply("This guild has not been configured.");
      return;
    }

    const updates = [];
    const channel = i.options.getChannel("channel");

    if (channel) updates.push(["logs.channel", channel.id]);

    if (!updates.length) {
      await i.editReply("Nothing to update - provide a channel.");
      return;
    }

    await i.client.settings.updateMany(i.guild, updates);
    await i.editReply("Logs settings saved.");
  },
};
