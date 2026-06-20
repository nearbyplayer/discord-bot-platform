import { ChannelType, SlashCommandSubcommandBuilder } from "discord.js";

/**
 * Action configuration fragment. The base `/config` assembler appends this
 * subcommand and routes `/config action` here — the base never names action.
 */
export default {
  subcommand: new SlashCommandSubcommandBuilder()
    .setName("action")
    .setDescription("Configure action request channel and IA acronym.")
    .addChannelOption(option =>
      option
        .setName("action_requests_channel")
        .setDescription("Channel where department action requests will be posted.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addStringOption(option =>
      option
        .setName("ia_acronym")
        .setDescription("The IA unit's abbreviation (e.g. IAD, IA).")
        .setRequired(false),
    ),
  async execute(i) {
    if (!i.client.settings.has(i.guild)) {
      await i.editReply("This guild has not been configured.");
      return;
    }

    const updates = [];
    const channel = i.options.getChannel("action_requests_channel");
    const iaAcronym = i.options.getString("ia_acronym");

    if (channel) updates.push(["action_requests_channel", channel.id]);
    if (iaAcronym !== null) updates.push(["ia_acronym", iaAcronym]);

    if (!updates.length) {
      await i.editReply("Nothing to update — provide a channel and/or IA acronym.");
      return;
    }

    await i.client.settings.updateMany(i.guild, updates);
    await i.editReply("Action settings saved.");
  },
};
