// Node Modules
import { ChannelType, SlashCommandSubcommandBuilder } from "discord.js";

// The department's `/config` fragments: role-tier configuration (the data behind
// the permission ladder) and the department log channel. Appended to `/config`
// by the settings capability's assembler and routed here by subcommand name.

const rolesSubcommand = new SlashCommandSubcommandBuilder()
  .setName("roles")
  .setDescription("Used by an Administrator to configure a guild's roles configuration.")
  .addStringOption(option =>
    option
      .setChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" })
      .setDescription("Used to choose the operation.")
      .setName("operation")
      .setRequired(true),
  )
  .addStringOption(option =>
    option
      .setChoices(
        { name: "Employee", value: "employee" },
        { name: "Command", value: "command" },
        { name: "High Command", value: "high" },
        { name: "Internal Affairs", value: "ia" },
      )
      .setDescription("Which roleset to modify [employee, command, high, ia].")
      .setName("roleset")
      .setRequired(true),
  )
  .addRoleOption(option =>
    option.setDescription("The role to add to the roleset.").setRequired(true).setName("role"),
  );

const logChannelSubcommand = new SlashCommandSubcommandBuilder()
  .setName("log_channel")
  .setDescription("Used by an Administrator to set the department log channel.")
  .addChannelOption(option =>
    option
      .setName("channel")
      .setDescription("The department log channel.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  );

async function handleRoles(i) {
  if (!i.client.settings.has(i.guild)) {
    return i.editReply("This guild has not been configured.");
  }

  const operation = i.options.getString("operation");
  const roleSet = i.options.getString("roleset");
  const role = i.options.getRole("role");
  const settings = i.client.settings.get(i.guild);
  const roleSetValues = settings.roles[roleSet];

  if (operation === "add") {
    if (roleSetValues.includes(role.id)) {
      return i.editReply("This role is already included in the specified roleset.");
    }
    await i.client.settings.update(i.guild, `roles.${roleSet}`, [...roleSetValues, role.id]);
    return i.editReply("Successfully saved changes to the specified roleset.");
  }

  if (operation === "remove") {
    if (!roleSetValues.includes(role.id)) {
      return i.editReply("This role is not included in the specified roleset.");
    }
    await i.client.settings.update(
      i.guild,
      `roles.${roleSet}`,
      roleSetValues.filter(e => e !== role.id),
    );
    return i.editReply("Successfully saved changes to the specified roleset.");
  }
}

async function handleLogChannel(i) {
  await i.client.settings.ensure(i.guildId);
  await i.client.settings.update(i.guild, "action_log_channel", i.options.getChannel("channel").id);
  return i.editReply("Department log channel saved.");
}

export default {
  subcommands: [rolesSubcommand, logChannelSubcommand],
  async execute(i) {
    switch (i.options.getSubcommand()) {
      case "roles":
        return handleRoles(i);
      case "log_channel":
        return handleLogChannel(i);
    }
  },
};
