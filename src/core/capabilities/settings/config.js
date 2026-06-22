// Node Modules
import { getEmbedColorChoices } from "#modules/Util";
import { InteractionContextType, SlashCommandBuilder } from "discord.js";

// The subcommand names the settings capability owns (generic, domain-free).
// Anything else on `/config` is contributed by a manifest and routed to that
// manifest's `config.execute`.
const BASE_SUBCOMMANDS = new Set(["reload", "init", "edit"]);

// A manifest may contribute a single config subcommand (`config.subcommand`) or
// several (`config.subcommands`); normalize to an array.
function manifestSubcommands(manifest) {
  const c = manifest.config;
  if (!c) return [];
  if (c.subcommands) return c.subcommands;
  if (c.subcommand) return [c.subcommand];
  return [];
}

/**
 * Build the `/config` command, appending every manifest's contributed config
 * subcommand(s). The assembler never names a feature - it iterates `config`
 * fragments.
 * @param {Array<{ config?: object }>} [manifests]
 * @returns {SlashCommandBuilder}
 */
function build(manifests = []) {
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
        ),
    )
    .setContexts(InteractionContextType.Guild);

  // Append manifest-contributed config subcommands. The assembler stays
  // domain-free: it knows nothing about department/loa/etc - only that a manifest
  // may supply one or more.
  for (const manifest of manifests) {
    for (const sub of manifestSubcommands(manifest)) data.addSubcommand(sub);
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
    },
  },
  async execute(i) {
    const subcommand = i.options.getSubcommand();

    // Route manifest-contributed subcommands to their owning manifest.
    if (!BASE_SUBCOMMANDS.has(subcommand)) {
      const owner = [...(i.client.capabilities ?? []), ...(i.client.features ?? [])].find(m =>
        manifestSubcommands(m).some(sub => sub.name === subcommand),
      );
      if (owner) return owner.config.execute(i);
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
        await i.client.settings.update(i.guild, "color", i.options.getString("color"));

        await i.editReply("Guild settings initialized.");
        break;
      }
      case "edit": {
        await i.client.settings.ensure(i.guildId);

        const color = i.options.getString("color");
        if (color !== null) await i.client.settings.update(i.guild, "color", color);

        await i.editReply("Guild settings saved.");
        break;
      }
    }
  },
};
