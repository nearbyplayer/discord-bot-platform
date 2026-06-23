import Watchlist from "./module.js";
import { ChannelType, InteractionContextType, SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("watchlist")
    .setDescription("Manage the in-game watchlist.")
    .addSubcommand(subcommand =>
      subcommand
        .setName("add")
        .setDescription("Add a user to the watchlist.")
        .addStringOption(option =>
          option.setName("username").setDescription("Roblox username to watch.").setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Why are you adding this user?")
            .setRequired(true),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("remove")
        .setDescription("Remove a user from the watchlist.")
        .addStringOption(option =>
          option.setName("username").setDescription("Roblox username to remove.").setRequired(true),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("view")
        .setDescription("View a watchlist entry.")
        .addStringOption(option =>
          option
            .setName("username")
            .setDescription("Whose entry do you want to view?")
            .setRequired(true),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("check")
        .setDescription("Check if a user is currently in-game.")
        .addStringOption(option =>
          option.setName("username").setDescription("Roblox username to check.").setRequired(true),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("set_channel")
        .setDescription("Used to set the watchlist channel.")
        .addChannelOption(option =>
          option
            .setDescription("Used to set watchlist channel.")
            .addChannelTypes(ChannelType.GuildText)
            .setName("watchlist_channel")
            .setRequired(true),
        ),
    )
    .setContexts(InteractionContextType.Guild),
  permissions: {
    default: "ia",
    subcommands: {
      set_channel: "administrator",
      add: "ia",
      remove: "ia",
      view: "ia",
      check: "ia",
    },
  },
  async execute(i) {
    switch (i.options.getSubcommand()) {
      case "add":
        await Watchlist.add(i);
        break;
      case "remove":
        await Watchlist.remove(i);
        break;
      case "view":
        await Watchlist.view(i);
        break;
      case "check":
        await Watchlist.check(i);
        break;
      case "set_channel": {
        const watchlistChannel = i.options.getChannel("watchlist_channel");
        await i.client.settings.update(i.guild, "watchlist_channel", watchlistChannel.id);
        await i.editReply("Watchlist channel saved.");

        break;
      }
    }
  },
};
