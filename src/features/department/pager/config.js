import { ChannelType, SlashCommandSubcommandBuilder } from "discord.js";

/**
 * Pager configuration fragment. The base `/config` assembler appends this
 * subcommand and routes `/config pager` here - the base never names pager.
 */
export default {
  subcommand: new SlashCommandSubcommandBuilder()
    .setName("pager")
    .setDescription("Configure a pager type and its destination.")
    .addStringOption(option =>
      option
        .setName("operation")
        .setDescription("Whether to save or remove a pager.")
        .addChoices({ name: "Set", value: "set" }, { name: "Remove", value: "remove" })
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName("type")
        .setDescription("Pager name, for example tow, swat, tsu, etc.")
        .setRequired(true),
    )
    .addChannelOption(option =>
      option
        .setDescription("Channel where this pager should be sent.")
        .addChannelTypes(ChannelType.GuildText)
        .setName("channel")
        .setRequired(false),
    )
    .addRoleOption(option =>
      option
        .setDescription("Role to mention when this pager is sent.")
        .setName("role")
        .setRequired(false),
    ),
  async execute(i) {
    if (!i.client.settings.has(i.guild)) {
      await i.editReply("This guild has not been configured.");
      return;
    }

    const operation = i.options.getString("operation");
    const type = i.options.getString("type").trim().toLowerCase();
    const channel = i.options.getChannel("channel");
    const role = i.options.getRole("role");
    const settings = i.client.settings.get(i.guild);

    if (operation === "set") {
      if (!channel || !role) {
        await i.editReply("Setting a pager requires both a channel and a role.");
        return;
      }

      settings.pagers.set(type, {
        channel: channel.id,
        role: role.id,
      });
      await i.client.settings.save(i.guild);
      await i.editReply(`Saved pager \`${type}\` for <#${channel.id}> and <@&${role.id}>.`);
      return;
    }

    if (!settings.pagers.has(type)) {
      await i.editReply(`Pager \`${type}\` is not configured.`);
      return;
    }

    settings.pagers.delete(type);
    await i.client.settings.save(i.guild);
    await i.editReply(`Removed pager \`${type}\`.`);
  },
};
