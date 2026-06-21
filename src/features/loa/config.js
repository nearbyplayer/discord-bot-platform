import { ChannelType, SlashCommandSubcommandBuilder } from "discord.js";

/**
 * LOA configuration fragment. The base `/config` assembler appends this
 * subcommand and routes `/config loa` here - the base never names LOA.
 */
export default {
  subcommand: new SlashCommandSubcommandBuilder()
    .setName("loa")
    .setDescription("Configure the LOA request channel and role.")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel where LOA requests will be posted.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Role assigned to members while on LOA.")
        .setRequired(false),
    ),
  async execute(i) {
    if (!i.client.settings.has(i.guild)) {
      await i.editReply("This guild has not been configured.");
      return;
    }

    const updates = [];
    const channel = i.options.getChannel("channel");
    const role = i.options.getRole("role");

    if (channel) updates.push(["loa.channel", channel.id]);
    if (role) updates.push(["loa.role", role.id]);

    if (!updates.length) {
      await i.editReply("Nothing to update - provide a channel and/or role.");
      return;
    }

    await i.client.settings.updateMany(i.guild, updates);
    await i.editReply("LOA settings saved.");
  },
};
