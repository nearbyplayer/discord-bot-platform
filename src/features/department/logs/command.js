// Node Modules
import { InteractionContextType, SlashCommandBuilder } from "discord.js";

// Modules
import Logs from "./module.js";
import { ValidationError } from "#src/errors";

// Command
export default {
  data: new SlashCommandBuilder()
    .setName("log")
    .setDescription("Used to interact with the logging system.")
    .addSubcommand(subcommand =>
      subcommand
        .setName("submit")
        .setDescription("Submit an activity log.")
        .addStringOption(option =>
          option
            .setName("date")
            .setDescription("Date: MM/DD/YYYY or DDMMMYYYY (e.g., 12/25/2024 or 25DEC2024)")
            .setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName("stime")
            .setDescription("Start time: H:MMam/pm, HH:MM or HHMM (e.g., 9:30am, 09:30 or 0930)")
            .setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName("simage")
            .setDescription("What is the URL of the start screenshot?")
            .setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName("etime")
            .setDescription("End time: H:MMam/pm HH:MM or HHMM (e.g., 5:30pm, 17:30 or 1730)")
            .setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName("eimage")
            .setDescription("What is the URL of the end screenshot?")
            .setRequired(true),
        )
        .addRoleOption(option =>
          option
            .setName("unit")
            .setDescription("(Optional) Specify a unit to create a special log.")
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("view")
        .setDescription("View a user's activity logs.")
        .addUserOption(option =>
          option
            .setName("member")
            .setDescription("Who's logs would you like to view?")
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("fetch")
        .setDescription("View a submitted log by ID.")
        .addStringOption(option =>
          option
            .setName("logid")
            .setDescription("What is the log ID of the log you'd like to view?")
            .setRequired(true),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("delete")
        .setDescription("Delete an activity log.")
        .addStringOption(option =>
          option
            .setName("id")
            .setDescription("What log would you like to delete?")
            .setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Why do you want to delete that log?")
            .setRequired(true),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("check")
        .setDescription("Check a unit's activity logs.")
        .addRoleOption(option =>
          option
            .setName("unit")
            .setDescription("What units logs would you like to view?")
            .setRequired(true),
        )
        .addBooleanOption(option =>
          option.setName("save").setDescription("Save message in chat?").setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand.setName("stats").setDescription("Check statistics for all units."),
    )
    .addSubcommand(subcommand => subcommand.setName("reset").setDescription("Reset the log cycle."))
    .addSubcommand(subcommand =>
      subcommand
        .setName("toggle")
        .setDescription("Toggles the log cycle.")
        .addBooleanOption(option =>
          option
            .setName("value")
            .setDescription("Would you like to turn it on or off?")
            .setRequired(true),
        ),
    )
    .addSubcommandGroup(subcommandGroup =>
      subcommandGroup
        .setName("quota")
        .setDescription("Manage log quotas for units.")
        .addSubcommand(subcommand =>
          subcommand
            .setName("set")
            .setDescription("Set the log quota for a unit.")
            .addStringOption(option =>
              option
                .setName("type")
                .setDescription("What type of quota?")
                .setRequired(true)
                .addChoices(
                  { name: "Activity Log", value: "activity" },
                  { name: "Special Log", value: "special" },
                ),
            )
            .addRoleOption(option =>
              option
                .setName("unit")
                .setDescription("What unit do you want to set the log quota for?")
                .setRequired(true),
            )
            .addIntegerOption(option =>
              option
                .setName("count")
                .setDescription("How many logs should the unit do?")
                .setRequired(true),
            )
            .addIntegerOption(option =>
              option
                .setName("time")
                .setDescription("How many minutes should each log be?")
                .setRequired(true),
            )
            .addIntegerOption(option =>
              option
                .setName("priority")
                .setDescription(
                  "Priority (for activity logs only - secondary units should be lower).",
                )
                .setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("clear")
            .setDescription("Clear the log quota for a unit.")
            .addStringOption(option =>
              option
                .setName("type")
                .setDescription("What type of quota?")
                .setRequired(true)
                .addChoices(
                  { name: "Activity Log", value: "activity" },
                  { name: "Special Log", value: "special" },
                ),
            )
            .addRoleOption(option =>
              option
                .setName("unit")
                .setDescription("What unit do you want to clear the log quota for?")
                .setRequired(true),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("view")
            .setDescription("View the log quota for a unit.")
            .addRoleOption(option =>
              option
                .setName("unit")
                .setDescription("What unit do you want to view the log quota for?")
                .setRequired(true),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("exempt")
            .setDescription("Exempt a role from log requirements.")
            .addRoleOption(option =>
              option
                .setName("role")
                .setDescription("What role do you want to exempt from logs?")
                .setRequired(true),
            )
            .addBooleanOption(option =>
              option
                .setName("value")
                .setDescription("True - exempt; False - not exempt")
                .setRequired(true),
            ),
        ),
    )
    .setContexts(InteractionContextType.Guild),
  permissions: {
    default: "employee",
    subcommands: {
      submit: "employee",
      view: "employee",
      fetch: "employee",
      delete: "employee",
      check: "command",
      stats: "command",
      reset: "high_command",
      set: "high_command",
      clear: "high_command",
      exempt: "high_command",
      toggle: "high_command",
    },
  },
  async execute(i) {
    const subcommandGroup = i.options.getSubcommandGroup();
    const subcommand = i.options.getSubcommand();

    if (subcommandGroup === "quota") {
      switch (subcommand) {
        case "set":
          await Logs.setQuota(i);
          break;
        case "clear":
          await Logs.clearQuota(i);
          break;
        case "view":
          await Logs.viewQuota(i);
          break;
        case "exempt":
          await Logs.exemptRole(i);
          break;
      }
      return;
    }

    switch (subcommand) {
      case "submit": {
        const settings = i.client.settings.get(i.guild);
        if (!settings.logs.active)
          throw new ValidationError("The log cycle is not currently active.");

        await Logs.submit(i);
        break;
      }
      case "view": {
        await Logs.view(i);
        break;
      }
      case "fetch": {
        await Logs.fetch(i);
        break;
      }
      case "delete": {
        await Logs.delete(i);
        break;
      }
      case "check": {
        i.client.settings.requireOrThrow(i.guild, "logs");

        const checkSettings = i.client.settings.get(i.guild);
        if (!checkSettings.logs.active)
          throw new ValidationError("The log cycle is not currently active.");

        await Logs.check(i);
        break;
      }
      case "stats": {
        await Logs.stats(i);
        break;
      }
      case "reset": {
        await Logs.reset(i);
        break;
      }
      case "toggle": {
        const value = i.options.getBoolean("value");
        await i.client.settings.update(i.guild, "logs.active", value);
        await i.editReply(`Successfully ${value ? "activated" : "deactivated"} the log cycle.`);
        break;
      }
    }
  },
};
