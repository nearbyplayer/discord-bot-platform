// Node Modules
import { getEmbedColorChoices } from "#modules/Util";
import { ChannelType, InteractionContextType, SlashCommandBuilder } from "discord.js";

// The subcommand names the base owns. Anything else on `/config` is contributed
// by a feature and routed to that feature's `config.execute`.
const BASE_SUBCOMMANDS = new Set(["reload", "init", "edit", "roles"]);

/**
 * Build the `/config` command, appending each feature's contributed config
 * subcommand. The base never names a feature — it iterates `config` fragments.
 * @param {Array<{ config?: { subcommand: import('discord.js').SlashCommandSubcommandBuilder } }>} [features]
 * @returns {SlashCommandBuilder}
 */
function build(features = []) {
  const data = new SlashCommandBuilder()
    .setName("config")
    .setDescription("Used to configure bot settings.")
    .addSubcommand(subcommand =>
      subcommand.setName("reload").setDescription("Used by the bot owner to reload its config."),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("init")
        .setDescription("Used by an Administrator to init a guild's configuration.")
        .addStringOption(option =>
          option
            .setName("color")
            .setDescription("What color do you want the guild embed color to be?")
            .addChoices(...getEmbedColorChoices())
            .setRequired(true),
        )
        .addChannelOption(option =>
          option
            .setDescription("Used to set the department log channel.")
            .addChannelTypes(ChannelType.GuildText)
            .setName("action_log_channel")
            .setRequired(true),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("edit")
        .setDescription("Used by an Administrator to edit a guild's configuration.")
        .addStringOption(option =>
          option
            .setName("color")
            .setDescription("What color do you want the guild embed color to be?")
            .addChoices(...getEmbedColorChoices())
            .setRequired(false),
        )
        .addChannelOption(option =>
          option
            .setDescription("Used to set the department log channel.")
            .addChannelTypes(ChannelType.GuildText)
            .setName("action_log_channel")
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setDescription("Used by an Administrator to configure a guild's roles configuration.")
        .setName("roles")
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
          option
            .setDescription("The role to add to the roleset.")
            .setRequired(true)
            .setName("role"),
        ),
    )
    .setContexts(InteractionContextType.Guild);

  // Append feature-contributed config subcommands. The base stays domain-free:
  // it knows nothing about loa/logs/etc — only that a feature may supply one.
  for (const feature of features) {
    if (feature.config?.subcommand) data.addSubcommand(feature.config.subcommand);
  }

  return data;
}

// Command
export default {
  build,
  permissions: {
    default: "administrator",
    subcommands: {
      reload: "owner",
      init: "administrator",
      edit: "administrator",
      roles: "administrator",
    },
  },
  async execute(i) {
    const subcommand = i.options.getSubcommand();

    // Route feature-contributed subcommands to their owning feature.
    if (!BASE_SUBCOMMANDS.has(subcommand)) {
      const feature = i.client.features?.find(f => f.config?.subcommand?.name === subcommand);
      if (feature) return feature.config.execute(i);
      return i.editReply("That configuration option isn't available.");
    }

    switch (subcommand) {
      case "reload": {
        await i.client.settings.reload();
        await i.editReply("Bot configuration reloaded.");
        break;
      }
      case "init": {
        if (i.client.settings.has(i.guildId)) {
          return await i.editReply("Guild settings already initialized.");
        }

        await i.client.settings.ensure(i.guildId);
        await i.client.settings.updateMany(i.guild, [
          ["action_log_channel", i.options.getChannel("action_log_channel").id],
          ["color", i.options.getString("color")],
        ]);

        await i.editReply("Guild settings initialized.");
        break;
      }
      case "edit": {
        await i.client.settings.ensure(i.guildId);

        const updates = [];
        const color = i.options.getString("color");
        const actionLogChannel = i.options.getChannel("action_log_channel");

        if (actionLogChannel) updates.push(["action_log_channel", actionLogChannel.id]);
        if (color !== null) updates.push(["color", color]);

        await i.client.settings.updateMany(i.guild, updates);
        await i.editReply("Guild settings saved.");
        break;
      }
      case "roles": {
        if (!i.client.settings.has(i.guild)) {
          i.editReply("This guild has not been configured.");
          break;
        }

        const subcommandOp = i.options.getString("operation");
        const roleSet = i.options.getString("roleset");
        const role = i.options.getRole("role");
        const settings = i.client.settings.get(i.guild);
        const roleSetValues = settings.roles[roleSet];

        switch (subcommandOp) {
          case "add": {
            if (roleSetValues.includes(role.id)) {
              await i.editReply("This role is already included in the specified roleset.");
              break;
            }

            await i.client.settings.update(i.guild, `roles.${roleSet}`, [
              ...roleSetValues,
              role.id,
            ]);
            await i.editReply("Successfully saved changes to the specified roleset.");
            break;
          }
          case "remove": {
            if (!roleSetValues.includes(role.id)) {
              await i.editReply("This role is not included in the specified roleset.");
              break;
            }

            await i.client.settings.update(
              i.guild,
              `roles.${roleSet}`,
              roleSetValues.filter(e => e !== role.id),
            );
            await i.editReply("Successfully saved changes to the specified roleset.");
            break;
          }
        }

        break;
      }
    }
  },
};
