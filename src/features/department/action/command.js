// Node Modules
import { Colors, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";

// Modules
import { deptColorChoices } from "../lib/dept.js";
import { clearReply, confirmAction } from "#modules/Util";
import { ConfigError } from "#src/errors";

// Command
export default {
  data: new SlashCommandBuilder()
    .setName("action")
    .setDescription("Handles requesting and logging actions.")
    .addSubcommand(subcommand =>
      subcommand
        .setName("request")
        .setDescription("Sends a request for approval.")
        .addUserOption(option =>
          option
            .setName("employee")
            .setDescription("Who is this action against?")
            .setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName("action")
            .setDescription("What is the action?")
            .setRequired(true)
            .addChoices(
              { name: "resignation", value: "resignation" },
              { name: "demotion", value: "demotion" },
              { name: "promotion", value: "promotion" },
              { name: "transfer", value: "transfer" },
              { name: "recorded warning", value: "warning" },
              { name: "discharge", value: "discharge" },
            ),
        )
        .addStringOption(option =>
          option.setName("notes").setDescription("Any notes about the action?").setRequired(true),
        ),
    )
    .addSubcommandGroup(subcommandGroup =>
      subcommandGroup
        .setName("log")
        .setDescription("Posts a department action to the log channel.")
        .addSubcommand(subcommand =>
          subcommand
            .setName("discharge")
            .setDescription("Used to log a discharge.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option
                .setName("type")
                .setDescription("What type of discharge is this?")
                .addChoices(
                  { name: "honorable", value: "honorably" },
                  { name: "general", value: "generally" },
                  { name: "dishonorable", value: "dishonorably" },
                )
                .setRequired(true),
            )
            .addStringOption(option =>
              option
                .setName("notes")
                .setDescription("Why are they being discharged?")
                .setRequired(true),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("resignation")
            .setDescription("Used to log a resignation.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option
                .setName("notes")
                .setDescription("Why are they being discharged?")
                .setRequired(true),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("demotion")
            .setDescription("Used to log a demotion.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addRoleOption(option =>
              option
                .setName("rank")
                .setDescription("What rank are they being demoted to?")
                .setRequired(true),
            )
            .addRoleOption(option =>
              option
                .setName("unit")
                .setDescription("What unit are they being demoted in?")
                .setRequired(false),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("promotion")
            .setDescription("Used to log a promotion.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addRoleOption(option =>
              option
                .setName("rank")
                .setDescription("What rank are they being promoted to?")
                .setRequired(true),
            )
            .addRoleOption(option =>
              option
                .setName("unit")
                .setDescription("What unit are they being promoted in?")
                .setRequired(false),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("transfer")
            .setDescription("Used to log a transfer.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addRoleOption(option =>
              option
                .setName("unit")
                .setDescription("What unit are they being transferred to?")
                .setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("transfer_promo")
            .setDescription("Used to log a transfer + promotion.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addRoleOption(option =>
              option
                .setName("unit")
                .setDescription("What unit are they being transferred to?")
                .setRequired(true),
            )
            .addRoleOption(option =>
              option
                .setName("rank")
                .setDescription("What rank are they being promoted to?")
                .setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("transfer_demo")
            .setDescription("Used to log a transfer + demotion.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addRoleOption(option =>
              option
                .setName("unit")
                .setDescription("What unit are they being transferred to?")
                .setRequired(true),
            )
            .addRoleOption(option =>
              option
                .setName("rank")
                .setDescription("What rank are they being demoted to?")
                .setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("probation")
            .setDescription("Used to log a probation period.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option
                .setName("duration")
                .setDescription("How long is their probation (ex. seven days)?")
                .setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("admin_leave")
            .setDescription("Used to log an employee being placed on administrative leave.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("remove_admin")
            .setDescription("Used to log an employee being taken off administrative leave.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("suspension")
            .setDescription("Used to log an employee being suspended.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option
                .setName("end_date")
                .setDescription("When does their suspension end? (MM/DD/YYYY)")
                .setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("unsuspend")
            .setDescription("Used to log an employee being unsuspended.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("verbal_warning")
            .setDescription("Used to log a verbal warning.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option
                .setName("notes")
                .setDescription("Why are they being warned?")
                .setRequired(true),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("recorded_warning")
            .setDescription("Used to log a recorded warning.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option
                .setName("notes")
                .setDescription("Why are they being warned?")
                .setRequired(true),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("accept_loa")
            .setDescription("Used to log an LOA.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option
                .setName("until")
                .setDescription("When are they on LOA until? (MM/DD/YYYY)")
                .setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("remove_loa")
            .setDescription("Used to log the end of an LOA.")
            .addUserOption(option =>
              option.setName("employee").setDescription("Who is this action on?").setRequired(true),
            )
            .addStringOption(option =>
              option.setName("notes").setDescription("Any additional notes?").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("custom")
            .setDescription("Used to log a custom action.")
            .addStringOption(option =>
              option.setName("text").setDescription("What is the action?").setRequired(true),
            )
            .addStringOption(option =>
              option
                .setName("color")
                .setDescription("What color do you want the embed to be?")
                .addChoices(...deptColorChoices())
                .setRequired(true),
            ),
        ),
    )
    .setContexts(InteractionContextType.Guild),
  permissions: "command",
  async execute(i) {
    if (i.options.getSubcommand() === "request") {
      i.client.settings.requireOrThrow(i.guild, "action_requests_channel");

      const settings = i.client.settings.get(i.guild);
      const embed = new EmbedBuilder().setTitle("Action Request").setColor(settings.color);
      embed.setDescription(
        `An administrative action has been requested by **${i.member.displayName}**.`,
      );

      const targetUser = i.options.getUser("employee");
      const employeeMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
      const employee = employeeMember?.displayName ?? targetUser.username;
      const action = i.options.getString("action");
      const notes = i.options.getString("notes");

      embed.addFields(
        {
          name: "Employee",
          value: `[${employee}](https://www.roblox.com/user.aspx?username=${employee})`,
        },
        { name: "Action", value: action.toUpperCase() },
        { name: "Notes", value: notes },
      );
      const confirmed = await confirmAction(i, {
        content: "Please confirm this is correct.",
        embeds: [embed],
      });
      if (!confirmed) return;

      const channel = await i.guild.channels
        .fetch(settings.action_requests_channel)
        .catch(() => null);

      if (!channel) {
        throw new ConfigError(
          "Your request has not been sent. The configured action requests channel is invalid or inaccessible.",
        );
      }

      try {
        await channel.send({ embeds: [embed] });
      } catch {
        throw new ConfigError(
          "Your request has not been sent. Please notify a server administrator to check channel permissions.",
        );
      }

      return clearReply(i, "Sent request.");
    }

    if (i.options.getSubcommandGroup() === "log") {
      i.client.settings.requireOrThrow(i.guild, "action_log_channel");

      const settings = i.client.settings.get(i.guild);
      const embed = new EmbedBuilder()
        .setTitle("Department Action")
        .setColor(settings.color)
        .setFooter({ text: i.member.displayName });

      const user = i.options.getUser("employee");
      const notes = i.options.getString("notes");
      const action = i.options.getSubcommand();
      const rank = i.options.getRole("rank");
      const unit = i.options.getRole("unit");

      if (user) {
        let employee = i.guild.members.cache.get(user.id)?.displayName;

        if (!employee) {
          embed.setDescription(`<@${user.id}>`);
        } else {
          embed.setDescription(`**${employee}**`);
        }
      }

      if (notes) {
        embed.addFields({ name: "Notes", value: notes });
      }

      switch (action) {
        case "discharge": {
          const type = i.options.getString("type");
          switch (type) {
            case "honorably":
              embed.setColor(Colors.Yellow);
              break;
            case "generally":
              embed.setColor(Colors.Yellow);
              break;
            case "dishonorably":
              embed.setColor(Colors.Red);
              break;
          }
          embed.setDescription(embed.data.description + ` has been **${type}** discharged.`);
          break;
        }
        case "resignation":
          embed.setDescription(
            embed.data.description + ` has **resigned** from the ${i.guild.name}.`,
          );
          embed.setColor(Colors.Yellow);
          break;
        case "demotion":
          embed.setDescription(
            embed.data.description +
              ` has been **demoted** to **${rank.name}**${unit ? ` within **${unit.name}**` : ""}.`,
          );
          embed.setColor(Colors.Red);
          break;
        case "promotion":
          embed.setDescription(
            embed.data.description +
              ` has been **promoted** to **${rank.name}**${unit ? ` within **${unit.name}**` : ""}.`,
          );
          embed.setColor(Colors.Green);
          break;
        case "transfer":
          embed.setDescription(
            embed.data.description + ` has been **transferred** to **${unit.name}**.`,
          );
          embed.setColor(Colors.Navy);
          break;
        case "transfer_promo":
          embed.setDescription(
            embed.data.description +
              ` has been **promoted** to **${rank.name}** and **transferred** to **${unit.name}**.`,
          );
          embed.setColor(Colors.Green);
          break;
        case "transfer_demo":
          embed.setDescription(
            embed.data.description +
              ` has been **demoted** to **${rank.name}** and **transferred** to **${unit.name}**.`,
          );
          embed.setColor(Colors.Red);
          break;
        case "probation":
          embed.setDescription(
            embed.data.description +
              ` is now on **probation** for the next **${i.options.getString("duration")}**.`,
          );
          embed.setColor(Colors.DarkGreen);
          break;
        case "admin_leave":
          embed.setDescription(
            embed.data.description +
              ` has been placed on **administrative leave**.\n\nContact ${settings.ia_acronym} Command or High Command if seen on team.`,
          );
          embed.setColor(Colors.DarkGold);
          break;
        case "remove_admin":
          embed.setDescription(
            embed.data.description + " is no longer on **administrative leave**.",
          );
          embed.setColor(Colors.Navy);
          break;
        case "suspension":
          embed.setDescription(
            embed.data.description +
              ` has been **suspended** until **${i.options.getString("end_date")}**.\n\nContact ${settings.ia_acronym} Command or High Command if seen on team.`,
          );
          embed.setColor(Colors.DarkGold);
          break;
        case "unsuspend":
          embed.setDescription(embed.data.description + " has been **unsuspended**.");
          embed.setColor(Colors.Navy);
          break;
        case "verbal_warning":
          embed.setDescription(embed.data.description + " has received a **verbal warning**.");
          embed.setColor(Colors.DarkGold);
          break;
        case "recorded_warning":
          embed.setDescription(embed.data.description + " has received a **recorded warning**.");
          embed.setColor(Colors.DarkGold);
          break;
        case "accept_loa":
          embed.setDescription(
            embed.data.description +
              ` is now on a **leave of absence** until **${i.options.getString("until")}**.`,
          );
          embed.setColor(Colors.Navy);
          break;
        case "remove_loa":
          embed.setDescription(embed.data.description + " is no longer on a leave of absence.");
          embed.setColor(Colors.Navy);
          break;
        case "custom": {
          embed.setDescription(`${i.options.getString("text")}`);
          const color = i.options.getString("color");
          embed.setColor(color === "Dept" ? embed.data.color : color);
          break;
        }
      }

      const confirmed = await confirmAction(i, {
        content: "Please confirm this is correct.",
        embeds: [embed],
      });
      if (!confirmed) return;

      const channel = await i.guild.channels.fetch(settings.action_log_channel).catch(() => null);
      if (!channel) {
        throw new ConfigError(
          "The department log channel is invalid or inaccessible. Please contact a server administrator.",
        );
      }

      try {
        await channel.send({ embeds: [embed] });
      } catch {
        throw new ConfigError(
          `Cannot send messages in <#${settings.action_log_channel}>. Please check channel permissions.`,
        );
      }

      return clearReply(i, "Successfully logged.");
    }
  },
};
