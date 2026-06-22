import LoaSchema from "./schema.js";
import { postToDeptLog } from "../lib/dept.js";
import { captureException } from "#modules/Sentry";
import { clearReply, sendUserDM } from "#modules/Util";
import { ConfigError, DatabaseError, ValidationError } from "#src/errors";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { DateTime } from "luxon";

/**
 * Delete an LOA record by ID with database error classification.
 * @param {string} recordId
 * @param {object} [context]
 */
async function deleteRecordById(recordId, context = {}) {
  try {
    await LoaSchema.deleteOne({ _id: recordId }).exec();
  } catch (error) {
    throw new DatabaseError("Failed to delete LOA record.", error, context);
  }
}

/**
 * Executes the LOA cron job.
 * @param {import('discord.js').Client} client
 */
export async function executeCron(client) {
  const loaSubmissions = await LoaSchema.find({}).exec();
  const now = DateTime.now();

  for (const loaRecord of loaSubmissions) {
    try {
      const guild = await client.guilds.fetch(loaRecord.guild_id).catch(() => null);
      if (!guild) {
        await LoaSchema.deleteOne({ _id: loaRecord._id }).exec();
        continue;
      }

      const member = await guild.members.fetch(loaRecord.discord_id).catch(() => null);
      if (!member) {
        await LoaSchema.deleteOne({ _id: loaRecord._id }).exec();
        continue;
      }

      const settings = client.settings.get(loaRecord.guild_id);
      const loaRoleId = settings?.loa?.role;
      const loaChannelId = settings?.loa?.channel;
      if (!loaRoleId) continue;

      const end = DateTime.fromISO(loaRecord.end);
      if (end < now && !now.hasSame(end, "day")) {
        const hasRole = member.roles.cache.has(loaRoleId);
        await LoaSchema.deleteOne({ _id: loaRecord._id }).exec();

        const embed = LeaveOfAbsence.buildEmbed("ended", loaRecord, settings);
        await postToDeptLog(guild, settings, embed);

        if (!hasRole) continue;
        await member.roles.remove(loaRoleId, "LOA Expired");
        await sendUserDM(client, member.id, `Your LOA for \`${guild.name}\` has expired.`);
        continue;
      }

      const start = DateTime.fromISO(loaRecord.start);
      if (now >= start && !(now > end) && loaRecord.approved) {
        const hasRole = member.roles.cache.has(loaRoleId);
        if (hasRole) continue;

        await member.roles.add(loaRoleId, "LOA Issued");

        const embed = LeaveOfAbsence.buildEmbed("started", loaRecord, settings);
        await postToDeptLog(guild, settings, embed);
        await sendUserDM(client, member.id, `Your LOA for \`${guild.name}\` has started.`);
        continue;
      }

      if (now >= start && !loaRecord.approved) {
        try {
          if (!loaChannelId) {
            await sendUserDM(
              client,
              loaRecord.discord_id,
              `Your LOA for \`${guild.name}\` has been rejected.`,
            );
          } else {
            const channel = await guild.channels.fetch(loaChannelId).catch(() => null);
            const msg = channel
              ? await channel.messages.fetch(loaRecord.message_id).catch(() => null)
              : null;

            if (msg) {
              const embed = EmbedBuilder.from(msg.embeds[0]);
              embed.addFields([
                { name: "Processed By", value: "System", inline: true },
                { name: "Result", value: "Rejected", inline: true },
              ]);

              await msg.edit({
                content: "",
                embeds: [embed],
                components: [],
              });
            }

            await sendUserDM(
              client,
              loaRecord.discord_id,
              `Your LOA for \`${guild.name}\` has been rejected.`,
            );
          }
        } finally {
          await LoaSchema.deleteOne({ _id: loaRecord._id }).exec();
        }
      }
    } catch (error) {
      captureException(error, {
        module: "LeaveOfAbsence",
        function: "executeCron",
        record_id: loaRecord._id?.toString(),
      });
    }
  }
}

/**
 * Handles LOA request creation, lifecycle transitions, and cleanup.
 */
export default class LeaveOfAbsence {
  /**
   * Builds an LOA embed.
   * @param {"started"|"ended"|"requested"} type
   * @param {object} loaRecord
   * @param {object} settings
   * @param {string} [reason]
   * @returns {EmbedBuilder}
   */
  static buildEmbed(type, loaRecord, settings, reason = "N/A") {
    const startDate = DateTime.fromISO(loaRecord.start);
    const endDate = DateTime.fromISO(loaRecord.end);

    const embed = new EmbedBuilder()
      .addFields({ name: "Employee", value: loaRecord.member_name })
      .setColor(settings.color)
      .setTimestamp();

    switch (type) {
      case "started":
        embed.setTitle("LOA Started");
        embed.setColor("Blue");
        embed.setDescription(
          `**${loaRecord.member_name}** is now on LOA until **${endDate.toFormat("L/dd/yyyy")}**.`,
        );
        embed.setFields([]);
        return embed;
      case "ended":
        embed.setTitle("LOA Ended");
        embed.setColor("Blue");
        embed.setDescription(`**${loaRecord.member_name}** is no longer on LOA.`);
        embed.setFields([]);
        return embed;
      case "requested": {
        const durationDays = Math.ceil(endDate.diff(startDate, "days").days) + 1;
        embed.setTitle("LOA Request");
        embed.setColor("Orange");
        embed.addFields(
          { name: "Start Date", value: startDate.toFormat("L/dd/yyyy"), inline: true },
          { name: "End Date", value: endDate.toFormat("L/dd/yyyy"), inline: true },
          { name: "Duration", value: `${durationDays} days`, inline: true },
          ...(loaRecord.unit_name
            ? [{ name: "Division / Unit / Squad", value: loaRecord.unit_name }]
            : []),
          { name: "Reason", value: reason },
        );
        return embed;
      }
      default:
        throw new ValidationError(`Unknown LOA embed type: '${type}'.`);
    }
  }

  /**
   * Handle an LOA request.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  static async request(interaction) {
    const startDate = DateTime.fromFormat(interaction.options.getString("start"), "L/d/yyyy");
    const endDate = DateTime.fromFormat(interaction.options.getString("end"), "L/d/yyyy");
    const unit = interaction.options.getRole("unit");
    const reason = interaction.options.getString("reason");

    const settings = interaction.client.settings.get(interaction.guild);
    const loaChannelId = settings?.loa?.channel;

    if (!startDate.isValid) {
      throw new ValidationError("Invalid start date format. Please use MM/DD/YYYY.");
    }
    if (!endDate.isValid) {
      throw new ValidationError("Invalid end date format. Please use MM/DD/YYYY.");
    }

    const today = DateTime.now().startOf("day");
    if (startDate < today) {
      throw new ValidationError("Start date cannot be in the past.");
    }
    if (endDate <= startDate) {
      throw new ValidationError("End date must be after start date.");
    }
    if (endDate > startDate.plus({ weeks: 2 })) {
      throw new ValidationError("LOA duration cannot exceed 2 weeks from start date.");
    }

    const existingRequest = await LoaSchema.findOne({
      guild_id: interaction.guild.id,
      discord_id: interaction.member.id,
    }).exec();
    if (existingRequest) {
      if (!existingRequest.approved) {
        throw new ValidationError(
          "You already have a pending LOA request. If you need to make a change please cancel it.",
        );
      }
      throw new ValidationError(
        "You already have a scheduled/active LOA. If you need to make a change please cancel it.",
      );
    }

    const embed = LeaveOfAbsence.buildEmbed(
      "requested",
      {
        member_name: interaction.member.displayName,
        unit_name: unit?.name ?? "",
        start: startDate.toISODate(),
        end: endDate.toISODate(),
      },
      settings,
      reason,
    );

    await clearReply(interaction, "Submitting your request...");

    if (!loaChannelId) {
      throw new ConfigError("LOA requests channel is not configured.");
    }

    const channel = await interaction.guild.channels.fetch(loaChannelId).catch(() => null);
    if (!channel) {
      throw new ConfigError("LOA requests channel is invalid or inaccessible.");
    }

    const loaRecord = new LoaSchema({
      member_name: interaction.member.displayName,
      guild_id: interaction.guild.id,
      discord_id: interaction.user.id,
      unit_id: unit?.id ?? "",
      unit_name: unit?.name ?? "",
      start: startDate.toISODate(),
      end: endDate.toISODate(),
      reason,
    });

    try {
      await loaRecord.save();
    } catch (error) {
      throw new DatabaseError("Failed to save LOA request to database.", error, {
        guild_id: interaction.guild.id,
        discord_id: interaction.user.id,
      });
    }

    embed.setFooter({ text: `Request ID: ${loaRecord._id}` });

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_loa_${loaRecord._id}`)
        .setStyle(ButtonStyle.Success)
        .setLabel("Approve"),
      new ButtonBuilder()
        .setCustomId(`reject_loa_${loaRecord._id}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel("Reject"),
    );

    try {
      const msg = await channel.send({
        content: unit?.id ? `<@&${unit.id}>` : "",
        embeds: [embed],
        components: [buttonRow],
      });
      loaRecord.message_id = msg.id;
      await loaRecord.save();
    } catch {
      await deleteRecordById(loaRecord._id, {
        guild_id: interaction.guild.id,
        discord_id: interaction.user.id,
      });
      throw new ConfigError("Failed to submit LOA request.");
    }

    await sendUserDM(interaction.client, interaction.user.id, {
      content: `Your LOA request for \`${interaction.guild.name}\` has been submitted and is awaiting approval.`,
    });

    return clearReply(
      interaction,
      `Your LOA request has been submitted and is awaiting approval. (Request ID: \`${loaRecord._id}\`)`,
    );
  }

  /**
   * Handle an LOA cancellation.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  static async cancel(interaction) {
    const reason = interaction.options.getString("reason");
    const target = interaction.options.getUser("target") ?? interaction.user;

    if (target.id !== interaction.user.id) {
      interaction.client.permissions.require(
        interaction.member,
        "command",
        "You need to be Command to cancel someone's LOA.",
      );
    }

    const settings = interaction.client.settings.get(interaction.guild);
    const loaRoleId = settings?.loa?.role;
    const loaChannelId = settings?.loa?.channel;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    const loaRecord = await LoaSchema.findOne({
      guild_id: interaction.guild.id,
      discord_id: target.id,
    }).exec();
    if (!loaRecord) {
      throw new ValidationError("No pending or approved LOA found to cancel.");
    }

    await clearReply(interaction, "Processing cancellation...");

    if (loaRecord.approved && member && loaRoleId) {
      await member.roles.remove(loaRoleId).catch(() => null);
    }

    if (loaRecord.message_id && loaChannelId) {
      try {
        const loaChannel = await interaction.guild.channels.fetch(loaChannelId).catch(() => null);
        const requestMsg = loaChannel
          ? await loaChannel.messages.fetch(loaRecord.message_id).catch(() => null)
          : null;

        if (requestMsg) {
          const canceledEmbed = EmbedBuilder.from(requestMsg.embeds[0]);
          canceledEmbed.setDescription(
            `Request canceled by ${interaction.member.displayName} for \`${reason}\`.`,
          );
          canceledEmbed.setColor("Grey");
          await requestMsg.edit({ content: "", embeds: [canceledEmbed], components: [] });
        }
      } catch {
        // Message may have been deleted already - not critical
      }
    }

    if (target.id !== interaction.user.id) {
      await sendUserDM(
        interaction.client,
        target.id,
        `Your LOA for \`${interaction.guild.name}\` has been canceled by ${interaction.member.displayName} with reason: ${reason}`,
      );
    }

    await deleteRecordById(loaRecord._id, {
      record_id: loaRecord._id.toString(),
      guild_id: interaction.guild.id,
      discord_id: target.id,
    });

    return clearReply(interaction, "Successfully canceled LOA request.");
  }

  /**
   * Handles button interactions for LeaveOfAbsence.
   * @param {import('discord.js').ButtonInteraction} interaction
   * @param {string} action
   */
  static async buttonInteraction(interaction, action) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const settings = interaction.client.settings.get(interaction.guild);
    const loaRoleId = settings?.loa?.role;

    interaction.client.permissions.require(
      interaction.member,
      "command",
      `You need Command permissions to ${action} LOA requests.`,
    );

    const recordId = interaction.customId.replace(`${action}_loa_`, "");

    const loaRecord = await LoaSchema.findOne({
      guild_id: interaction.guild.id,
      _id: recordId,
    }).exec();
    if (!loaRecord) {
      throw new ValidationError(
        "LOA record not found or already processed. Only pending requests can use these buttons.",
        {
          guild_id: interaction.guild.id,
          record_id: recordId,
        },
      );
    }

    const startDate = DateTime.fromISO(loaRecord.start);

    if (action === "approve") {
      const member = await interaction.guild.members.fetch(loaRecord.discord_id).catch(() => null);
      if (!member) {
        await deleteRecordById(recordId, { guild_id: interaction.guild.id, record_id: recordId });
        await interaction.message.edit({ content: "", components: [] });
        throw new ValidationError(
          "The member who requested this LOA is no longer in the server. The request has been removed.",
        );
      }

      loaRecord.approved_by = interaction.member.displayName;
      loaRecord.approved = true;
      await loaRecord.save();

      const embed = EmbedBuilder.from(interaction.message.embeds[0]);
      embed.setColor("Green");
      embed.addFields([
        { name: "Processed By", value: interaction.member.displayName, inline: true },
        { name: "Result", value: "Approved", inline: true },
      ]);

      await interaction.message.edit({
        content: "",
        embeds: [embed],
        components: [],
      });

      if (DateTime.now() >= startDate) {
        if (loaRoleId) {
          await member.roles.add(loaRoleId, "LOA Issued").catch(() => null);
        }

        await postToDeptLog(
          interaction.guild,
          settings,
          LeaveOfAbsence.buildEmbed("started", loaRecord, settings),
        );

        await sendUserDM(
          interaction.client,
          loaRecord.discord_id,
          `Your LOA request for \`${interaction.guild.name}\` has been approved and started.`,
        );

        await interaction.editReply("LOA request approved and started.");
        return;
      }

      await sendUserDM(
        interaction.client,
        loaRecord.discord_id,
        `Your LOA request for \`${interaction.guild.name}\` has been approved! The LOA role will be automatically assigned at midnight on the start date.`,
      );

      await interaction.editReply(
        `LOA request approved. The LOA role will be automatically assigned at midnight on ${startDate.toFormat("L/d/yyyy")}.`,
      );
      return;
    }

    if (action === "reject") {
      const embed = EmbedBuilder.from(interaction.message.embeds[0]);
      embed.setColor("Red");
      embed.addFields([
        { name: "Processed By", value: interaction.member.displayName, inline: true },
        { name: "Result", value: "Rejected", inline: true },
      ]);

      await deleteRecordById(recordId, {
        guild_id: interaction.guild.id,
        record_id: recordId,
      });

      await interaction.message.edit({
        content: "",
        embeds: [embed],
        components: [],
      });

      await sendUserDM(
        interaction.client,
        loaRecord.discord_id,
        `Your LOA request for \`${interaction.guild.name}\` has been rejected.`,
      );

      await interaction.editReply("LOA request rejected successfully.");
      return;
    }

    throw new ValidationError(`Unknown LOA button action '${action}'.`);
  }

  /**
   * Clean up all LOA records for a guild or member.
   * @param {{guild_id: string, discord_id?: string}} filter
   */
  static async cleanup(filter) {
    try {
      await LoaSchema.deleteMany(filter).exec();
    } catch (error) {
      captureException(
        error,
        { module: "LeaveOfAbsence", function: "cleanup", ...filter },
        { report: true },
      );
    }
  }
}
