// Node Modules
import { InteractionContextType, SlashCommandBuilder } from "discord.js";

// Modules
import AutoLogs from "./module.js";
import { ValidationError } from "#src/errors";

export default {
  data: new SlashCommandBuilder()
    .setName("autolog")
    .setDescription("Automatic in-game log tracking.")
    .addSubcommandGroup(group =>
      group
        .setName("team")
        .setDescription("Configure auto-log team settings.")
        .addSubcommand(subcommand =>
          subcommand
            .setName("set")
            .setDescription("Set the in-game team acronym used for auto logging.")
            .addStringOption(option =>
              option
                .setName("acronym")
                .setDescription("The in-game team acronym, for example RSP.")
                .setRequired(true),
            ),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("start")
        .setDescription("Start an in-game log session.")
        .addRoleOption(option =>
          option
            .setName("unit")
            .setDescription("(Optional) Specify a unit to create a special log.")
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("status")
        .setDescription("Check your active in-game log status.")
        .addRoleOption(option =>
          option
            .setName("unit")
            .setDescription("(Optional) Check a special log for a unit.")
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("end")
        .setDescription("End and submit your active in-game log.")
        .addRoleOption(option =>
          option
            .setName("unit")
            .setDescription("(Optional) End a special log for a unit.")
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("cancel")
        .setDescription("Cancel your active in-game log without submitting.")
        .addRoleOption(option =>
          option
            .setName("unit")
            .setDescription("(Optional) Cancel a special log for a unit.")
            .setRequired(false),
        ),
    )
    .setContexts(InteractionContextType.Guild),
  permissions: {
    default: "employee",
    subcommands: {
      set: "administrator",
      start: "employee",
      status: "employee",
      end: "employee",
      cancel: "employee",
    },
  },
  async execute(i) {
    if (i.options.getSubcommandGroup(false) === "team") {
      const acronym = i.options.getString("acronym").trim();
      if (!acronym) {
        throw new ValidationError("The auto-log team acronym cannot be empty.");
      }

      await i.client.settings.update(i.guild, "autolog.team", acronym);
      await i.editReply(`Auto-log team set to \`${acronym}\`.`);
      return;
    }

    i.client.settings.requireOrThrow(i.guild, "autolog.team");

    const settings = i.client.settings.get(i.guild);
    if (!settings.logs.active) {
      throw new ValidationError("The log cycle is not currently active.");
    }

    switch (i.options.getSubcommand()) {
      case "start":
        await AutoLogs.start(i);
        break;
      case "status":
        await AutoLogs.status(i);
        break;
      case "end":
        await AutoLogs.end(i);
        break;
      case "cancel":
        await AutoLogs.cancel(i);
        break;
    }
  },
};
