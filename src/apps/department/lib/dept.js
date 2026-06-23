/**
 * Department-shared helpers, relocated out of the kernel `Util` so the kernel
 * names no department concepts. Used by the department parent's subfeatures.
 */
import { getEmbedColorChoices } from "#modules/Util";

/**
 * Post an embed to the guild's department log channel (if configured).
 * @param {import('discord.js').Guild} guild
 * @param {Object} settings - Guild settings (must carry `action_log_channel`)
 * @param {import('discord.js').EmbedBuilder} embed
 * @param {{ throwOnError?: boolean }} [options]
 * @returns {Promise<import('discord.js').Message|null>}
 */
export async function postToDeptLog(guild, settings, embed, { throwOnError = false } = {}) {
  if (!settings.action_log_channel) {
    return null;
  }

  try {
    const channel = await guild.channels.fetch(settings.action_log_channel).catch(() => null);
    if (!channel) {
      if (throwOnError) {
        throw new Error("action_log_channel channel not found or inaccessible");
      }
      return null;
    }

    const message = await channel.send({ embeds: [embed] });
    return message;
  } catch (error) {
    if (throwOnError) {
      throw error;
    }
    return null;
  }
}

/**
 * Embed color choices including the department `Dept` color. Builds on the
 * kernel's generic palette.
 */
export function deptColorChoices() {
  return [...getEmbedColorChoices(), { name: "dept", value: "Dept" }];
}
