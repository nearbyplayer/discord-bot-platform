import ActiveSchema from "./schema.js";
import { findInGame } from "#apps/department/ingame/lookup";
import Logs from "#apps/department/logs/module";
import { captureException } from "#modules/Sentry";
import { clearReply, confirmAction, sendUserDM } from "#modules/Util";
import { DatabaseError, ValidationError } from "#src/errors";
import { EmbedBuilder } from "discord.js";
import { DateTime } from "luxon";

function isOnLoa(settings, member) {
  const loaRoleId = settings?.loa?.role ?? "";
  if (!loaRoleId) return false;
  return member.roles.cache.has(loaRoleId);
}

export default {
  buildLogEmbed(i, log) {
    const embed = Logs.buildBaseLogEmbed(i, log);
    const start = DateTime.fromISO(log.start_time);
    const end = DateTime.fromISO(log.end_time);

    embed.spliceFields(2, 5);
    embed.addFields(
      { name: "Start Time", value: `<t:${Math.floor(start.valueOf() / 1000)}:T>` },
      { name: "End Time", value: `<t:${Math.floor(end.valueOf() / 1000)}:T>` },
      { name: "Bot Verified", value: "✅" },
      { name: "Duration", value: `${log.duration} minutes` },
    );

    if (log.flagged) {
      const flagDescriptions = {
        time: "This log has been flagged for department command review, you do not need to take any action at this time.",
        bot: "The bot automatically submitted this log when returning online and the log time may not be accurate.",
      };
      embed.setTitle(`❗ ${log.is_special ? "Special" : "Activity"} Log`);
      embed.setDescription(`This log has been flagged. ${flagDescriptions[log.flagged] ?? ""}`);
      embed.setColor("Red");
    }

    return embed;
  },

  async start(i) {
    const settings = i.client.settings.get(i.guild);
    const unit = i.options.getRole("unit");
    const isSpecial = !!unit;
    const specialFor = isSpecial ? unit.id : undefined;

    const exempt = Logs.isExempt(settings, i.member, specialFor);
    if (exempt)
      throw new ValidationError(`You are exempt from${isSpecial ? " special " : " "}logs.`);

    const onLoa = isOnLoa(settings, i.member);
    if (onLoa) throw new ValidationError("You are currently on LOA.");

    const ig = findInGame(i.client.logs?.cache, i.member.displayName);
    if (!ig || ig !== settings.autolog?.team) {
      throw new ValidationError("You were not found in-game on-team, try again in 30 seconds.");
    }

    const exists = await ActiveSchema.findOne({
      discord_id: i.member.id,
      guild_id: i.guild.id,
      is_special: isSpecial,
      special_for: specialFor,
    }).exec();

    if (exists) {
      const start = DateTime.fromISO(exists.start);
      throw new ValidationError(
        `You already have an active log, it started at <t:${Math.floor(start.valueOf() / 1000)}:T>.`,
      );
    }

    const embed = new EmbedBuilder()
      .setTitle("Activity Log Agreement")
      .setColor(settings.color)
      .setDescription(
        `By using this system you agree:\n\n` +
          `- If you leave and your log is less than your quota your log will be voided.\n\n` +
          `- If a server switch takes more than 30 seconds your log data may be lost.\n\n` +
          `- Log data may not be saved in the event the bot shuts down unexpectedly.\n\n` +
          `It is suggested you still take start/end pictures to ensure you can submit your log if you encounter an issue with this system.`,
      );

    const confirmed = await confirmAction(i, {
      content: "Please agree to the terms below.",
      embeds: [embed],
      submitLabel: "Agree",
      cancelLabel: "Decline",
      cancelMessage: "Your log has not been started as you did not agree to the terms.",
    });
    if (!confirmed) return;

    const time = DateTime.now();
    const active = new ActiveSchema({
      special_for: isSpecial ? specialFor : undefined,
      username: i.member.displayName,
      discord_id: i.member.id,
      is_special: isSpecial,
      guild_id: i.guild.id,
      last_active: time.toISO(),
      start: time.toISO(),
      team: ig,
    });

    try {
      await active.save();
    } catch (e) {
      throw new DatabaseError("Failed to start your log.", e, {
        module: "AutoLogs",
        function: "start",
      });
    }

    const quota = Logs.getQuota(settings, i.member, specialFor);
    const end = time.plus({ minutes: quota.time });
    return clearReply(
      i,
      `Your log started at <t:${Math.floor(time.valueOf() / 1000)}:T>. You may submit your log at <t:${Math.floor(end.valueOf() / 1000)}:T>.`,
    );
  },

  async status(i) {
    const unit = i.options.getRole("unit");
    const isSpecial = !!unit;
    const specialFor = isSpecial ? unit.id : undefined;

    const exists = await ActiveSchema.findOne({
      discord_id: i.member.id,
      guild_id: i.guild.id,
      is_special: isSpecial,
      special_for: specialFor,
    }).exec();

    if (!exists) throw new ValidationError("You do not have an active log.");

    const settings = i.client.settings.get(i.guild);
    const quota = Logs.getQuota(settings, i.member, specialFor);
    const start = DateTime.fromISO(exists.start);

    if (!quota) {
      return i.editReply(
        `Your log started at <t:${Math.floor(start.valueOf() / 1000)}:T>. Your quota could not be determined - use \`/autolog end\` to submit or \`/autolog cancel\` to cancel.`,
      );
    }

    const end = start.plus({ minutes: quota.time });
    return i.editReply(
      `Your log started at <t:${Math.floor(start.valueOf() / 1000)}:T>. You may submit your log at <t:${Math.floor(end.valueOf() / 1000)}:T>.`,
    );
  },

  async end(i) {
    const unit = i.options.getRole("unit");
    const isSpecial = !!unit;
    const specialFor = isSpecial ? unit.id : undefined;

    const log = await ActiveSchema.findOne({
      discord_id: i.member.id,
      guild_id: i.guild.id,
      is_special: isSpecial,
      special_for: specialFor,
    }).exec();

    if (!log) throw new ValidationError("You do not have an active log.");

    await this.submit(i.client, log, i);
  },

  async cancel(i) {
    const unit = i.options.getRole("unit");
    const isSpecial = !!unit;
    const specialFor = isSpecial ? unit.id : undefined;

    const deleted = await ActiveSchema.deleteOne({
      discord_id: i.member.id,
      guild_id: i.guild.id,
      is_special: isSpecial,
      special_for: specialFor,
    }).exec();

    if (deleted.deletedCount === 0) {
      throw new ValidationError("You do not have an active log to cancel.");
    }

    return i.editReply("Your active log has been cancelled.");
  },

  async submit(client, info, i, flag) {
    const start = DateTime.fromISO(info.start);
    const end = flag ? DateTime.fromISO(info.last_active) : DateTime.now();
    const t = Math.round(end.diff(start, "minutes").toObject().minutes);

    const guild = await client.guilds.fetch(info.guild_id).catch(() => null);
    if (!guild) {
      await ActiveSchema.deleteOne({ _id: info._id })
        .exec()
        .catch(() => {});
      return;
    }

    const member = await guild.members.fetch(info.discord_id).catch(() => null);
    if (!member) {
      await ActiveSchema.deleteOne({ _id: info._id })
        .exec()
        .catch(() => {});
      return;
    }

    const settings = client.settings.get(guild);
    const quota = Logs.getQuota(settings, member, info.special_for);

    if (!quota) {
      await ActiveSchema.deleteOne({ _id: info._id })
        .exec()
        .catch(() => {});
      await sendUserDM(
        client,
        member.id,
        `An error occurred when trying to submit your log, please manually submit it. Your log started at <t:${Math.floor(start.valueOf() / 1000)}:T>.`,
      );
      return;
    }

    if (t < quota.time) {
      if (i) {
        return i.editReply(
          "Your log does not meet the time requirement and has not been submitted. To cancel it use `/autolog cancel`.",
        );
      }
      await ActiveSchema.deleteOne({ _id: info._id })
        .exec()
        .catch(() => {});
      await sendUserDM(
        client,
        member.id,
        `Your log does not meet the time requirement and has not been submitted. Your log started at <t:${Math.floor(start.valueOf() / 1000)}:T>.`,
      );
      return;
    }

    const flagTime = 240;
    let flagType;
    if (flag) flagType = "bot";
    else if (t > flagTime) flagType = "time";

    await ActiveSchema.deleteOne({ _id: info._id })
      .exec()
      .catch(e => {
        captureException(
          e,
          { module: "AutoLogs", function: "submit.deleteActive" },
          { report: true },
        );
      });

    const log = new Logs.LogModel({
      special_for: info.is_special ? info.special_for : undefined,
      username: member.displayName,
      is_special: info.is_special,
      discord_id: member.id,
      guild_id: guild.id,
      bot_verified: true,
      start_time: start.toISO(),
      start_image: "",
      end_image: "",
      end_time: end.toISO(),
      duration: t,
      date: start.toISO(),
    });

    if (flagType) log.flagged = flagType;

    try {
      await log.save();
    } catch (e) {
      captureException(e, { module: "AutoLogs", function: "submit.log.save" }, { report: true });
      if (i) {
        return i.editReply(
          "An error occurred submitting your log. Please verify if your log was submitted, if not then submit it manually.",
        );
      }
      return;
    }

    const embed = this.buildLogEmbed({ client, guild }, log);

    if (settings.logs.channel) {
      const channel = await guild.channels.fetch(settings.logs.channel).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    }

    await sendUserDM(client, member.id, { embeds: [embed] });

    if (i) return clearReply(i, "Your log has been submitted successfully.");
  },

  async cleanup(filter) {
    try {
      await ActiveSchema.deleteMany(filter).exec();
    } catch (error) {
      captureException(
        error,
        { module: "AutoLogs", function: "cleanup", ...filter },
        { report: true },
      );
    }
  },
};
