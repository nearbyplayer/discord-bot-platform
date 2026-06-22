// Node Modules
import LeaveOfAbsence from "./module.js";
import { InteractionContextType, SlashCommandBuilder } from "discord.js";

// Command
export default {
  data: new SlashCommandBuilder()
    .setName("loa")
    .setDescription("Handles leave of absence requests.")
    .addSubcommand(subcommand =>
      subcommand
        .setName("request")
        .setDescription("Submits a leave of absence request.")
        .addStringOption(option =>
          option.setName("start").setDescription("MM/DD/YYYY").setRequired(true),
        )
        .addStringOption(option =>
          option.setName("end").setDescription("MM/DD/YYYY").setRequired(true),
        )
        .addRoleOption(option =>
          option
            .setName("unit")
            .setDescription("Division / unit / squad for this leave request")
            .setRequired(true),
        )
        .addStringOption(option =>
          option.setName("reason").setDescription("Reason for leave of absence").setRequired(true),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("cancel")
        .setDescription("Cancels a leave of absence.")
        .addStringOption(option =>
          option.setName("reason").setDescription("Reason for canceling").setRequired(true),
        )
        .addUserOption(option =>
          option
            .setName("target")
            .setDescription("If not yourself, select a target")
            .setRequired(false),
        ),
    )
    .setContexts(InteractionContextType.Guild),
  permissions: {
    default: "employee",
  },
  async execute(i) {
    const subcommand = i.options.getSubcommand();

    i.client.settings.requireOrThrow(i.guild, "loa.channel");
    i.client.settings.requireOrThrow(i.guild, "loa.role");

    if (subcommand === "request") {
      await LeaveOfAbsence.request(i);
    } else if (subcommand === "cancel") {
      await LeaveOfAbsence.cancel(i);
    }
  },
};
