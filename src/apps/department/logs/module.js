// Node Modules
import { captureException } from "#modules/Sentry";
import { DatabaseError, ValidationError } from "#src/errors";
import { Colors, EmbedBuilder } from "discord.js";
import { DateTime } from "luxon";
import { isValidObjectId } from "mongoose";

// Modules
import {
  clearReply,
  confirmAction,
  getMembersWithRole,
  pagedEmbed,
  pagedEmbedButtons,
} from "#modules/Util";

// DB Schemas
import LogSchema from "./schema.js";

// Variables
const formats = { date: "L/d/yyyy", time: "h:mma" };

const flagDescriptions = {
  time: "This log has been flagged for department command review, you do not need to take any action at this time.",
  bot: "The bot automatically submitted this log when returning online and the log time may not be accurate.",
};

const IMAGE_HOSTS = new Set([
  "media.discordapp.net",
  "cdn.discordapp.com",
  "i.gyazo.com",
  "i.imgur.com",
  "imgur.com",
  "gyazo.com",
  "prnt.sc",
]);

const IMAGE_EXTENSIONS = new Set(["webp", "jpeg", "jpg", "png", "gif", "bmp"]);

// Utility Functions
function isOnLoa(settings, member) {
  const loaRoleId = settings?.loa?.role ?? "";
  if (!loaRoleId) return false;
  return member.roles.cache.has(loaRoleId);
}

function hasExemptRole(settings, member) {
  return member.roles.cache.some(r => settings.logs.exempt.includes(r.id));
}

/**
 * Parse a date string in specific formats: MM/DD/YYYY or DDMMMYYYY.
 * Examples: "12/25/2024", "25Dec2024", "01Jan2024"
 * @param {string} input - Date string from user
 * @returns {DateTime|null} - Luxon DateTime object or null if invalid
 */
function parseFlexibleDate(input) {
  if (!input) return null;

  const trimmed = input.trim();

  // Try MM/DD/YYYY format
  let parsed = DateTime.fromFormat(trimmed, "M/d/yyyy");
  if (parsed.isValid) return parsed;

  // Try DDMMMYYYY format (e.g., 25Dec2024)
  parsed = DateTime.fromFormat(trimmed, "ddMMMyyyy");
  if (parsed.isValid) return parsed;

  return null;
}

/**
 * Parse a time string - MUST include minutes (hours:minutes format required).
 * Accepts formats like: "5:30pm", "5:30 pm", "17:30"
 * Rejects: "5pm", "5 pm" (no minutes)
 * @param {string} input - Time string from user
 * @returns {DateTime|null} - Luxon DateTime object or null if invalid
 */
function parseFlexibleTime(input) {
  if (!input) return null;

  const trimmed = input.trim();

  // Normalize: remove extra spaces, lowercase
  const normalized = trimmed.toLowerCase().replace(/\s+/g, "");

  // Only accept formats that include minutes
  const timeFormats = [
    "h:mma", // 5:30pm
    "HH:mm", // 17:30
    "HHmm", // 1730
  ];

  for (const format of timeFormats) {
    const parsed = DateTime.fromFormat(normalized, format);
    if (parsed.isValid) return parsed;
  }

  // Also try with space before am/pm (before normalization)
  const parsedWithSpace = DateTime.fromFormat(trimmed.toLowerCase(), "h:mm a");
  if (parsedWithSpace.isValid) return parsedWithSpace;

  return null;
}

/**
 * Validate that a URL is a valid HTTPS image URL.
 * @param {string} url - URL string to validate
 * @returns {boolean} - True if valid image URL
 */
function isValidImageUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);

    // Must be HTTPS
    if (parsed.protocol !== "https:") return false;

    // Check for common image extensions or common image hosts
    const extension = parsed.pathname.split(".").pop().toLowerCase();
    return IMAGE_EXTENSIONS.has(extension) || IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function groupLogsByMemberId(logs) {
  const logsByMember = new Map();

  for (const log of logs) {
    if (!logsByMember.has(log.discord_id)) {
      logsByMember.set(log.discord_id, []);
    }
    logsByMember.get(log.discord_id).push(log);
  }

  return logsByMember;
}

function summarizeLogs(logs, matchesLog, meetsQuota) {
  let submitted = 0;
  let totalTime = 0;
  let metQuota = 0;

  for (const log of logs) {
    if (!matchesLog(log)) continue;

    submitted++;
    totalTime += log.duration;

    if (meetsQuota(log)) {
      metQuota++;
    }
  }

  return { submitted, totalTime, metQuota };
}

function buildMemberStatusName(member, met, onLoa) {
  return (met || onLoa ? "✅ " : "❌ ") + member.displayName + (onLoa ? " (LOA)" : "");
}

/**
 * Activity log management system.
 *
 * Key concepts:
 * - Activity logs: Count toward ONE unit's quota (determined by priority)
 * - Special logs: Unit-specific logs, members can have multiple special quotas
 * - Date validation: Logs must be from current week
 */
export default {
  LogModel: LogSchema,
  /**
   * Build the shared base for log embeds.
   */
  buildBaseLogEmbed(i, log) {
    const settings = i.client.settings.get(i.guild);
    const embed = new EmbedBuilder()
      .setTitle(`${log.is_special ? "Special" : "Activity"} Log`)
      .setColor(settings.color);

    const start = DateTime.fromISO(log.start_time);
    const end = DateTime.fromISO(log.end_time);
    const date = DateTime.fromISO(log.date);

    embed.addFields(
      { name: "Username", value: log.username },
      { name: "Date", value: `<t:${Math.floor(date.valueOf() / 1000)}:d>` },
    );

    embed.addFields(
      { name: "Start Time", value: start.toFormat(formats.time) },
      { name: "End Time", value: end.toFormat(formats.time) },
    );

    embed.addFields(
      { name: "Start Image", value: log.start_image },
      { name: "End Image", value: log.end_image },
      { name: "Duration", value: `${log.duration} minutes` },
    );

    embed.setFooter({ text: `Log ID: ${log._id}` });

    embed.addFields({
      name: "Type",
      value: log.is_special ? "Special" : "Activity",
    });

    if (log.is_special) {
      const role = i.guild.roles.cache.find(r => r.id === log.special_for);
      if (role) embed.addFields({ name: "Unit", value: role.name });
      else embed.addFields({ name: "Unit", value: log.special_for });
    }

    return embed;
  },
  /**
   * Build a Discord embed displaying manual log details.
   */
  buildLogEmbed(i, log) {
    const embed = this.buildBaseLogEmbed(i, log);

    if (log.flagged) {
      embed.setTitle(`❗ ${log.is_special ? "Special" : "Activity"} Log`);
      embed.setDescription(`This log has been flagged. ${flagDescriptions[log.flagged] ?? ""}`);
      embed.setColor(Colors.Red);
    }

    return embed;
  },
  /**
   * Fetch and display a log by MongoDB ObjectId.
   */
  async fetch(i) {
    const _id = i.options.getString("logid");
    if (!isValidObjectId(_id)) throw new ValidationError("The ID you provided was invalid.");
    const log = await LogSchema.findOne({
      _id: _id,
      guild_id: i.guild.id,
    }).exec();
    if (!log) throw new ValidationError("There is no log submitted with that ID.");
    await i.editReply({ embeds: [this.buildLogEmbed(i, log)] });
  },
  /**
   * Check if member is exempt from quota requirements.
   * Exempt if: has exempt role OR has no configured quota.
   */
  isExempt(settings, member, specialFor) {
    if (hasExemptRole(settings, member)) return true;
    return this.getQuota(settings, member, specialFor) === undefined;
  },
  /**
   * Get the highest priority unit for a member (for activity logs).
   * Members can belong to multiple units but only count toward one.
   */
  getUnit(settings, member) {
    const units = member.roles.cache.filter(r => settings.logs.quota.has(r.id)).map(r => r.id);
    const logUnits = Array.from(settings.logs.quota.keys()).filter(unit => units.includes(unit));
    let unit = logUnits[0];

    for (const u of logUnits) {
      if (!settings.logs.quota.get(u) || !settings.logs.quota.get(unit)) continue;
      if (settings.logs.quota.get(u)?.priority > settings.logs.quota.get(unit)?.priority) unit = u;
    }

    return unit;
  },
  /**
   * Get all special units a member belongs to.
   * Unlike activity logs, members can have multiple special quotas.
   */
  getSpecialUnits(settings, member) {
    const units = member.roles.cache
      .filter(r => settings.logs.special_quota.has(r.id))
      .map(r => r.id);
    return Array.from(settings.logs.special_quota.keys()).filter(unit => units.includes(unit));
  },
  /**
   * Get quota requirements for a member.
   * Returns special quota if specialFor provided, otherwise activity quota.
   */
  getQuota(settings, member, specialFor) {
    if (specialFor) {
      return settings.logs.special_quota.get(specialFor);
    }

    return settings.logs.quota.get(this.getUnit(settings, member));
  },
  /**
   * Display a member's submitted logs and quota status.
   */
  async view(i) {
    const selectedUser = i.options.getUser("member");
    let member;
    let self = false;
    if (!selectedUser) {
      member = i.member;
      self = true;
    } else {
      member = await i.guild.members.fetch(selectedUser.id).catch(() => null);
      if (!member) throw new ValidationError("That user is not in this server.");
    }

    const gc = i.client.settings.get(i.guild);

    const logs = await LogSchema.find({
      discord_id: member.id,
      guild_id: i.guild.id,
    }).exec();
    const embed = new EmbedBuilder()
      .setTitle("Activity Logs")
      .setColor(gc.color)
      .setAuthor({ name: member.displayName });

    const quota = this.getQuota(gc, member);
    const specialUnits = this.getSpecialUnits(gc, member);
    // Exempt roles cover all logs; a member with only special quotas is not exempt,
    // they just have no activity quota.
    const exempt = hasExemptRole(gc, member) || (!quota && specialUnits.length === 0);
    const onLoa = isOnLoa(gc, member);

    if (exempt) embed.setDescription(`${self ? "You are" : "This user is"} **exempt** from logs.`);
    else if (onLoa) embed.setDescription(`${self ? "You are" : "This user is"} on LOA.`);
    else if (quota)
      embed.setDescription(`${self ? "You have" : "This user has"} **not met** the log quota.`);

    if (exempt || onLoa) {
      embed.setFooter({ text: "Page 1/1" });
      return i.editReply({ embeds: [embed] });
    }

    const fields = [];

    if (quota) {
      let metQuota = 0;

      for (const l of logs) {
        if (l.is_special) continue;
        if (l.duration >= quota.time) metQuota++;
        const tString = `${l.duration} ${l.duration > 1 ? "minutes" : "minute"}`;
        fields.push({
          name: `${l._id}`,
          value: `${DateTime.fromISO(l.date).toFormat(formats.date)} - ${tString}`,
        });
      }

      if (metQuota >= quota.count)
        embed.setDescription(`${self ? "You have" : "This user has"} **met** the log quota.`);
    }

    for (const unit of specialUnits) {
      const unitQuota = this.getQuota(gc, member, unit);
      const role = i.guild.roles.cache.find(r => r.id === unit);
      let met = 0;

      for (const l of logs) {
        if (!l.is_special || l.special_for !== unit) continue;
        if (l.duration >= unitQuota.time) met++;
        const tString = `${l.duration} ${l.duration > 1 ? "minutes" : "minute"}`;
        fields.push({
          name: `${l._id}`,
          value: `${DateTime.fromISO(l.date).toFormat(formats.date)} - ${tString} - ${role.name}`,
        });
      }

      const prefix = embed.data.description ? `${embed.data.description}\n` : "";
      embed.setDescription(
        prefix +
        `${self ? "You have" : "This user has"} **${met >= unitQuota.count ? "met" : "not met"}** the special log quota for ${role.name}.`,
      );
    }

    const embeds = pagedEmbed(embed, fields);

    if (embeds.length > 1) {
      await pagedEmbedButtons(i, embeds);
    } else if (embeds.length === 1) {
      await i.editReply({ embeds: embeds });
    }
  },
  /**
   * Show all members in a unit and their quota completion status.
   * Displays submitted count, total minutes, and whether they met quota.
   */
  async check(i) {
    const unit = i.options.getRole("unit");

    const gc = i.client.settings.get(i.guild);
    const specialQuota = gc.logs.special_quota.get(unit.id);
    const quota = gc.logs.quota.get(unit.id);

    if (!quota && !specialQuota)
      throw new ValidationError("That unit does not have log requirements.");

    const members = await getMembersWithRole(i.guild, unit.id);
    const fields = [];
    let notMet = 0;
    const allLogs = await LogSchema.find({ guild_id: i.guild.id }).exec();
    const logsByMember = groupLogsByMemberId(allLogs);

    for (const member of members) {
      // Only exempt roles skip the report; a member with only a special quota for this
      // unit has no activity quota but still counts here.
      if (hasExemptRole(gc, member)) continue;

      const logs = logsByMember.get(member.id) ?? [];

      if (this.getQuota(gc, member) !== quota && specialQuota) {
        const specialStats = summarizeLogs(
          logs,
          l => l.is_special && l.special_for === unit.id,
          l => l.duration >= specialQuota.time,
        );
        const met = specialStats.metQuota >= specialQuota.count;

        const onLoa = isOnLoa(gc, member);
        let value = `Submitted ${specialStats.submitted} special log${specialStats.submitted !== 1 ? "s" : ""}`;

        if (specialStats.submitted > 0)
          value += ` (${specialStats.totalTime} minute${specialStats.totalTime !== 1 ? "s" : ""})`;

        if (!met && !onLoa) notMet++;

        fields.push({
          name: buildMemberStatusName(member, met, onLoa),
          value: value,
          inline: true,
        });

        continue;
      }

      const specialStats = summarizeLogs(
        logs,
        l => Boolean(l.special_for) && (!specialQuota || l.special_for === unit.id),
        l => Boolean(specialQuota) && l.special_for === unit.id && l.duration >= specialQuota.time,
      );
      const regularStats = summarizeLogs(
        logs,
        l => (specialQuota ? l.special_for !== unit.id : !l.special_for),
        l => l.duration >= quota.time,
      );

      const totalTime = regularStats.totalTime;
      const metQuota = regularStats.metQuota;
      const met = metQuota >= quota.count;

      const totalSpecialTime = specialStats.totalTime;
      const metSpecialQuota = specialStats.metQuota;
      const specialMet = specialQuota ? metSpecialQuota >= specialQuota.count : true;
      const totalSpecial = specialStats.submitted;

      const onLoa = isOnLoa(gc, member);
      let value = `Submitted ${logs.length - totalSpecial} log${logs.length - totalSpecial !== 1 ? "s" : ""}`;

      if (logs.length > 0) value += ` (${totalTime} minute${totalTime !== 1 ? "s" : ""})`;

      if ((!met || !specialMet) && !onLoa) notMet++;

      if (specialQuota) {
        value += `\nSubmitted ${totalSpecial} special log${totalSpecial !== 1 ? "s" : ""}`;
        if (logs.length > 0)
          value += ` (${totalSpecialTime} minute${totalSpecialTime !== 1 ? "s" : ""})`;
      }

      fields.push({
        name: buildMemberStatusName(member, met, onLoa),
        value: value,
        inline: true,
      });
    }

    const embed = new EmbedBuilder().setTitle(`Log Statistics for ${unit.name}`).setColor(gc.color);

    if (notMet === 0) embed.setDescription("The quota was met by every member.");
    else
      embed.setDescription(
        `There ${notMet === 1 ? "is" : "are"} ${notMet} individual${notMet !== 1 ? "s" : ""} that do${notMet === 1 ? "es" : ""} not meet the activity quota.`,
      );

    const embeds = pagedEmbed(embed, fields);

    if (i.options.getBoolean("save") === true) {
      await i.editReply(`Fetched log statistics for ${unit.name}.`);
      await i.channel.send({ content: `<@${i.member.id}>`, embeds: embeds }).catch(() => {
        i.editReply({
          content: "Please contact a server administrator to give ridgeLOG access to this channel.",
          embeds: embeds,
        });
      });
    } else {
      const content = `Fetched log statistics for ${unit.name}.`;
      if (embeds.length > 1) {
        await pagedEmbedButtons(i, embeds, content);
      } else if (embeds.length === 1) {
        await i.editReply({ content: content, embeds: embeds });
      }
    }
  },
  /**
   * Reset the log cycle by deleting all logs.
   * Posts comprehensive final reports for all units before deletion.
   */
  async reset(i) {
    const gc = i.client.settings.get(i.guild);
    let postedFinalReports = false;

    // Pull ALL logs for the guild once (efficient!)
    const allLogs = await LogSchema.find({ guild_id: i.guild.id }).exec();
    const logsByMember = groupLogsByMemberId(allLogs);

    // Post final check reports for all units before deletion
    if (gc.logs.channel) {
      const channel = await i.guild.channels.fetch(gc.logs.channel).catch(() => null);
      if (channel) {
        postedFinalReports = true;
        await channel.send({
          content: "## Final Log Reports - Cycle Ending\n*Generating reports for all units...*",
        });

        const roles = await i.guild.roles.fetch();

        // Regular quota units
        for (const [unitId, quota] of gc.logs.quota.entries()) {
          const role = roles.get(unitId);
          if (!role) continue;

          const members = await getMembersWithRole(i.guild, unitId);
          const fields = [];
          let notMet = 0;

          for (const member of members) {
            if (hasExemptRole(gc, member)) continue;
            if (this.getQuota(gc, member) !== quota) continue;

            const memberLogs = logsByMember.get(member.id) ?? [];

            const stats = summarizeLogs(
              memberLogs,
              l => !l.is_special,
              l => l.duration >= quota.time,
            );

            const met = stats.metQuota >= quota.count;
            const onLoa = isOnLoa(gc, member);

            let value = `Submitted ${stats.metQuota}/${quota.count} logs`;
            if (stats.metQuota > 0)
              value += ` (${stats.totalTime} minute${stats.totalTime !== 1 ? "s" : ""})`;

            if (!met && !onLoa) notMet++;

            fields.push({
              name: buildMemberStatusName(member, met, onLoa),
              value: value,
              inline: true,
            });
          }

          if (fields.length > 0) {
            const embed = new EmbedBuilder()
              .setTitle(`${role.name} - Activity Logs`)
              .setColor(gc.color)
              .setDescription(
                `Quota: ${quota.count}x ${quota.time}min logs | ${fields.length - notMet}/${fields.length} members met quota`,
              );

            const embeds = pagedEmbed(embed, fields);
            for (const pageEmbed of embeds) {
              await channel.send({ embeds: [pageEmbed] });
            }
          }
        }

        // Special quota units
        for (const [unitId, specialQuota] of gc.logs.special_quota.entries()) {
          const role = roles.get(unitId);
          if (!role) continue;

          const members = await getMembersWithRole(i.guild, unitId);
          const fields = [];
          let notMet = 0;

          for (const member of members) {
            if (hasExemptRole(gc, member)) continue;

            const memberLogs = logsByMember.get(member.id) ?? [];

            const stats = summarizeLogs(
              memberLogs,
              l => l.is_special && l.special_for === unitId,
              l => l.duration >= specialQuota.time,
            );

            const met = stats.metQuota >= specialQuota.count;
            const onLoa = isOnLoa(gc, member);

            let value = `Submitted ${stats.metQuota}/${specialQuota.count} special logs`;
            if (stats.metQuota > 0)
              value += ` (${stats.totalTime} minute${stats.totalTime !== 1 ? "s" : ""})`;

            if (!met && !onLoa) notMet++;

            fields.push({
              name: buildMemberStatusName(member, met, onLoa),
              value: value,
              inline: true,
            });
          }

          if (fields.length > 0) {
            const embed = new EmbedBuilder()
              .setTitle(`${role.name} - Special Logs`)
              .setColor(gc.color)
              .setDescription(
                `Quota: ${specialQuota.count}x ${specialQuota.time}min special logs | ${fields.length - notMet}/${fields.length} members met quota`,
              );

            const embeds = pagedEmbed(embed, fields);
            for (const pageEmbed of embeds) {
              await channel.send({ embeds: [pageEmbed] });
            }
          }
        }
      }
    }

    // Now delete all logs
    const deleted = await LogSchema.deleteMany({ guild_id: i.guild.id }).exec();

    // Post reset confirmation
    const resetEmbed = new EmbedBuilder().setTitle("🔄 Log Cycle Reset").setColor(gc.color);
    resetEmbed.addFields(
      { name: "Executor", value: i.member.displayName },
      { name: "Total Logs Deleted", value: deleted.deletedCount.toString() },
    );

    if (gc.logs.channel) {
      const channel = await i.guild.channels.fetch(gc.logs.channel).catch(() => null);
      if (channel) await channel.send({ embeds: [resetEmbed] });
    }

    return i.editReply(
      postedFinalReports
        ? `Successfully reset log cycle. ${deleted.deletedCount} logs deleted. Final reports posted to <#${gc.logs.channel}>.`
        : `Successfully reset log cycle. ${deleted.deletedCount} logs deleted. Final reports were not posted because the logs channel is not configured or inaccessible.`,
    );
  },
  /**
   * Submit an activity or special log with comprehensive validation.
   * Validates: date format, time format, URLs, duration, duplicates, weekly range.
   */
  async submit(i) {
    const gc = i.client.settings.get(i.guild);
    const specialFor = i.options.getRole("unit");
    const exempt = this.isExempt(gc, i.member, specialFor ? specialFor.id : undefined);
    if (exempt) throw new ValidationError("You are exempt from logs.");

    const onLoa = isOnLoa(gc, i.member);
    if (onLoa) throw new ValidationError("You are currently on LOA.");

    // Parse date and times flexibly
    const date = parseFlexibleDate(i.options.getString("date"));
    const st = parseFlexibleTime(i.options.getString("stime"));
    const et = parseFlexibleTime(i.options.getString("etime"));
    const si = i.options.getString("simage");
    const ei = i.options.getString("eimage");

    // Validate parsed values
    if (!date || !date.isValid) {
      throw new ValidationError(
        "Invalid date format. Use MM/DD/YYYY (e.g., 12/25/2024) or DDMMMYYYY (e.g., 25Dec2024)",
      );
    }
    if (!st || !st.isValid) {
      throw new ValidationError(
        "Invalid start time format. Use H:MM format with am/pm (e.g., 5:30pm, 5:00pm) or 24-hour (e.g., 17:30)",
      );
    }
    if (!et || !et.isValid) {
      throw new ValidationError(
        "Invalid end time format. Use H:MM format with am/pm (e.g., 5:30pm, 5:00pm) or 24-hour (e.g., 17:30)",
      );
    }

    // Validate screenshot URLs
    if (!isValidImageUrl(si)) {
      throw new ValidationError(
        "Invalid start screenshot URL. Must be an HTTPS image link (jpg, png, gif, webp) or from a supported host (Imgur, Discord, Gyazo).",
      );
    }
    if (!isValidImageUrl(ei)) {
      throw new ValidationError(
        "Invalid end screenshot URL. Must be an HTTPS image link (jpg, png, gif, webp) or from a supported host (Imgur, Discord, Gyazo).",
      );
    }

    if (si === ei) throw new ValidationError("Your log screenshots cannot be the same.");

    // Date validation (must be within current week)
    const now = DateTime.now();
    const startOfWeek = now.startOf("week");
    const endOfWeek = now.endOf("week");

    if (date < startOfWeek || date > endOfWeek) {
      throw new ValidationError(
        `Logs must be from the current week (${startOfWeek.toFormat("M/d")} - ${endOfWeek.toFormat("M/d")}). ` +
        `You entered ${date.toFormat("M/d/yyyy")}.`,
      );
    }

    let e, s;

    if (st > et) {
      e = DateTime.fromFormat(
        date.toFormat(formats.date) + " " + et.toFormat(formats.time),
        formats.date + " " + formats.time,
      ).plus({ days: 1 });
    } else {
      e = DateTime.fromFormat(
        date.toFormat(formats.date) + " " + et.toFormat(formats.time),
        formats.date + " " + formats.time,
      );
    }

    s = DateTime.fromFormat(
      date.toFormat(formats.date) + " " + st.toFormat(formats.time),
      formats.date + " " + formats.time,
    );

    const t = e.diff(s, "minutes").toObject().minutes;

    // Duration validation
    if (t <= 0) {
      throw new ValidationError("Invalid log duration. End time must be after start time.");
    }

    const maxDuration = 720; // 12 hours
    if (t > maxDuration) {
      throw new ValidationError(
        `Log duration cannot exceed ${maxDuration / 60} hours (${maxDuration} minutes). Your log is ${t} minutes. Please verify your times.`,
      );
    }

    const quota = this.getQuota(gc, i.member, specialFor?.id);

    if (t < quota.time) {
      throw new ValidationError(
        `Your log is ${t} minutes but requires ${quota.time} minutes to meet quota.`,
      );
    }

    // Check for duplicate logs
    const duplicate = await LogSchema.findOne({
      discord_id: i.member.id,
      guild_id: i.guild.id,
      date: date.toISO(),
      start_time: s.toISO(),
      end_time: e.toISO(),
    }).exec();

    if (duplicate) {
      throw new ValidationError(
        "You've already submitted this exact log. Use `/log view` to see your submitted logs.",
      );
    }

    const log = new LogSchema({
      username: i.member.displayName,
      discord_id: i.member.id,
      guild_id: i.guild.id,
      is_special: false,
      start_image: si,
      start_time: s.toISO(),
      end_image: ei,
      end_time: e.toISO(),
      duration: t,
      date: date.toISO(),
    });

    if (specialFor && this.getQuota(gc, i.member, specialFor.id)) {
      log.is_special = true;
      log.special_for = specialFor.id;
    }

    const embed = this.buildLogEmbed(i, log);

    embed.setDescription(`**Duration:** ${t} minutes`);

    const confirmed = await confirmAction(i, {
      content: "**Review your log before submitting:**",
      embeds: [embed],
      submitLabel: "Submit Log",
    });
    if (!confirmed) return;

    try {
      await log.save();
    } catch (e) {
      throw new DatabaseError("An error occurred submitting your log.", e, {
        module: "Logs",
        function: "log.save (submit)",
      });
    }

    // Post to logs channel (non-critical, silently fail)
    if (gc.logs.channel) {
      const channel = await i.guild.channels.fetch(gc.logs.channel).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] }).catch(() => { });
    }

    try {
      await i.member.send({ embeds: [embed] });
    } catch {
      // If the user has DMs disabled, we don't want to throw an error
    }

    return clearReply(i, "Your log has been submitted successfully.");
  },
  async delete(i) {
    const _id = i.options.getString("id");
    const reason = i.options.getString("reason");

    if (!isValidObjectId(_id)) throw new ValidationError("The ID you provided was invalid.");

    const log = await LogSchema.findOne({
      _id: _id,
      guild_id: i.guild.id,
    }).exec();

    if (!log) throw new ValidationError(`No log was found with an ID of \`${_id}\`.`);

    if (log.discord_id !== i.member.id && !i.client.permissions.has(i.member, "command"))
      throw new ValidationError("You do not have permission to delete other users logs.");

    const settings = i.client.settings.get(i.guild);
    const embed = new EmbedBuilder().setTitle("Activity Log Deleted").setColor(settings.color);
    embed.addFields(
      { name: "Executor", value: i.member.displayName },
      { name: "Log ID", value: _id },
      { name: "Reason", value: reason },
    );

    try {
      await LogSchema.deleteOne({
        _id: _id,
        guild_id: i.guild.id,
      }).exec();
    } catch (e) {
      throw new DatabaseError("That log could not be deleted.", e, {
        module: "Logs",
        function: "deleteOne (log)",
      });
    }

    // Post to logs channel (non-critical, silently fail)
    if (settings.logs.channel) {
      const channel = await i.guild.channels.fetch(settings.logs.channel).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] }).catch(() => { });
    }

    try {
      const member = i.guild.members.cache.get(log.discord_id);
      await member.send({ embeds: [embed] });
    } catch {
      // ignored - user may have DMs disabled or left server
    }

    return i.editReply("Log deleted successfully.");
  },
  async stats(i) {
    const settings = i.client.settings.get(i.guild);

    if (!settings?.logs?.active)
      throw new ValidationError("The log cycle is not currently active.");

    const units = Array.from(settings.logs.quota.keys());
    const embed = new EmbedBuilder().setTitle("Log Statistics").setColor(settings.color);

    const allLogs = await LogSchema.find({ guild_id: i.guild.id }).exec();
    const tc = allLogs.length;
    embed.setDescription(`There was a total of ${tc} logs submitted this cycle.`);

    const logsByMember = groupLogsByMemberId(allLogs);

    const roles = await i.guild.roles.fetch();

    for (const unit of units) {
      const role = roles.get(unit);
      if (!role || !role.id) {
        const err = new Error(`no role for ${unit} when using stats command!`);
        captureException(err, { command: "log", subcommand: "stats", unit });
        continue;
      }

      const quota = settings.logs.quota.get(role.id);
      const members = await getMembersWithRole(i.guild, role.id);

      let lt = 0;
      let dt = 0;

      for (const member of members) {
        const exempt = this.isExempt(settings, member);
        if (exempt) continue;

        if (this.getQuota(settings, member) !== quota) continue;

        const memberLogs = logsByMember.get(member.id) ?? [];
        if (memberLogs.length === 0) continue;

        lt += memberLogs.length;
        dt += memberLogs.reduce((sum, log) => sum + log.duration, 0);
      }

      const ts = dt > 0 ? ` (${dt} minute${dt !== 1 ? "s" : ""})` : "";
      embed.addFields({ name: role.name, value: `Submitted ${lt} logs${ts}` });
    }

    await i.editReply({ embeds: [embed] });
  },
  async setQuota(i) {
    const type = i.options.getString("type");
    const isSpecial = type === "special";
    const unit = i.options.getRole("unit");
    const count = i.options.getInteger("count");
    const time = i.options.getInteger("time");
    const priority = i.options.getInteger("priority");

    if (!isSpecial && !priority) {
      throw new ValidationError("Priority is required for activity log quotas.");
    }

    const settings = i.client.settings.get(i.guild);
    const quotaPath = `logs.${isSpecial ? "special_quota" : "quota"}`;
    const quotas = new Map(settings.logs[isSpecial ? "special_quota" : "quota"]);

    quotas.set(unit.id, {
      count: count,
      time: time,
      ...(priority && { priority: priority }),
    });

    await i.client.settings.update(i.guild, quotaPath, quotas);

    await i.editReply(
      `Successfully set ${isSpecial ? "special " : ""}quota for **${unit.name}** with parameters: \`count: ${count}, time: ${time}` +
      (!isSpecial ? `, priority: ${priority}` : "") +
      "`.",
    );
  },
  async clearQuota(i) {
    const type = i.options.getString("type");
    const isSpecial = type === "special";
    const unit = i.options.getRole("unit");
    const settings = i.client.settings.get(i.guild);
    const quotaPath = `logs.${isSpecial ? "special_quota" : "quota"}`;
    const quotas = new Map(settings.logs[isSpecial ? "special_quota" : "quota"]);
    const quota = quotas.get(unit.id);

    if (!quota)
      throw new ValidationError(
        `There is no ${isSpecial ? "special " : ""}log quota set for ${unit.name}.`,
      );

    quotas.delete(unit.id);

    await i.client.settings.update(i.guild, quotaPath, quotas);

    await i.editReply(
      `Successfully cleared the ${isSpecial ? "special " : ""}log quota for **${unit.name}**.`,
    );
  },
  async viewQuota(i) {
    const unit = i.options.getRole("unit");
    const settings = i.client.settings.get(i.guild);
    const quota = settings.logs.quota.get(unit.id);
    const special_quota = settings.logs.special_quota.get(unit.id);

    if (!quota) throw new ValidationError("There is no quota for that unit currently.");

    i.editReply(
      `Quota for ${unit.name}: ${quota.count}x ${quota.time} minute logs.` +
      (special_quota
        ? `\n\nSpecial Quota for ${unit.name}: ${special_quota.count}x ${special_quota.time} minute special logs.`
        : ""),
    );
  },
  /**
   * List every configured quota (activity + special) and exempt role for the
   * guild. Roles are rendered as mentions, falling back to the stored id if the
   * role no longer exists.
   */
  async listQuotas(i) {
    const settings = i.client.settings.get(i.guild);
    const { quota, special_quota, exempt } = settings.logs;

    const role = id => (i.guild.roles.cache.has(id) ? `<@&${id}>` : `\`${id}\``);

    const embed = new EmbedBuilder().setTitle("Log Quotas").setColor(settings.color);

    const activity = Array.from(quota.entries())
      .map(([id, q]) => `${role(id)} - ${q.count}x ${q.time}min (priority ${q.priority})`)
      .join("\n");
    embed.addFields({ name: "Activity Quotas", value: activity || "*None configured.*" });

    const special = Array.from(special_quota.entries())
      .map(([id, q]) => `${role(id)} - ${q.count}x ${q.time}min special`)
      .join("\n");
    embed.addFields({ name: "Special Quotas", value: special || "*None configured.*" });

    const exemptRoles = exempt.map(role).join(", ");
    embed.addFields({ name: "Exempt Roles", value: exemptRoles || "*None.*" });

    await i.editReply({ embeds: [embed] });
  },
  async exemptRole(i) {
    const role = i.options.getRole("role");
    const value = i.options.getBoolean("value");
    const settings = i.client.settings.get(i.guild);
    const exists = settings.logs.quota.get(role.id) || settings.logs.special_quota.get(role.id);

    if (exists)
      throw new ValidationError("You must clear the quota for this role before exempting it.");

    const isExemptRole = settings.logs.exempt.includes(role.id);
    const exemptRoles = [...settings.logs.exempt];

    if (value && !isExemptRole) {
      exemptRoles.push(role.id);
    } else if (!value) {
      const index = exemptRoles.indexOf(role.id);
      if (index !== -1) exemptRoles.splice(index, 1);
    }

    await i.client.settings.update(i.guild, "logs.exempt", exemptRoles);

    await i.editReply(
      `Successfully ${value && !isExemptRole ? "exempted" : "un-exempted"} ${role.name}.`,
    );
  },
  /**
   * Clean up all submitted logs for a guild or member.
   * @param {{guild_id: string, discord_id?: string}} filter
   */
  async cleanup(filter) {
    try {
      await LogSchema.deleteMany(filter).exec();
    } catch (error) {
      captureException(error, { module: "Logs", function: "cleanup", ...filter }, { report: true });
    }
  },
};
