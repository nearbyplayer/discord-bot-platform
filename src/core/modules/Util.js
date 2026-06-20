// Node Modules
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} from "discord.js";
import { captureException } from "./Sentry.js";
import db from "#db";

const memberFetchTimestamps = new Map();
const memberFetchPromises = new Map();

/**
 * Utility functions
 * @module Util
 */

/**
 * Build a standard submit/cancel action row.
 * @param {{submitLabel: String, cancelLabel: String}?} options
 */
export function createSubmitCancelRow({ submitLabel = "Submit", cancelLabel = "Cancel" } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("submit").setLabel(submitLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("cancel").setLabel(cancelLabel).setStyle(ButtonStyle.Danger),
  );
}

/**
 * Await submit/cancel button click from a specific user.
 * @param {import('discord.js').Message} message
 * @param {String} userId
 * @param {{timeout: Number, submitId: String, cancelId: String}?} options
 */
export async function awaitButtonChoice(
  message,
  userId,
  { timeout = 15000, submitId = "submit", cancelId = "cancel" } = {},
) {
  try {
    const button = await message.awaitMessageComponent({
      filter: i => i.user.id === userId && (i.customId === submitId || i.customId === cancelId),
      componentType: ComponentType.Button,
      time: timeout,
    });

    return button.customId === submitId ? "submit" : "cancel";
  } catch {
    return "timeout";
  }
}

/**
 * Show a submit/cancel confirmation prompt and normalize cancel/timeout handling.
 * Returns true after moving the reply into a processing state; returns false if cancelled.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{
 *   content: string,
 *   embeds?: import('discord.js').EmbedBuilder[],
 *   submitLabel?: string,
 *   cancelLabel?: string,
 *   cancelMessage?: string,
 *   processingMessage?: string,
 *   timeout?: number
 * }} options
 */
export async function confirmAction(
  interaction,
  {
    content,
    embeds = [],
    submitLabel = "Submit",
    cancelLabel = "Cancel",
    cancelMessage = "Command canceled.",
    processingMessage = "Processing...",
    timeout = 15000,
  },
) {
  const message = await interaction.editReply({
    content,
    embeds,
    components: [createSubmitCancelRow({ submitLabel, cancelLabel })],
  });

  const choice = await awaitButtonChoice(message, interaction.user.id, { timeout });
  if (choice !== "submit") {
    await clearReply(interaction, cancelMessage);
    return false;
  }

  await clearReply(interaction, processingMessage);
  return true;
}

/**
 * Clear embeds/components while updating interaction reply content.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {String} content
 * @param {[import('discord.js').Embed]} embeds
 * @param {[import('discord.js').ActionRowData]} components
 */
export async function clearReply(interaction, content, embeds = [], components = []) {
  return interaction.editReply({ content, embeds, components });
}

/**
 * Shared embed color choices for slash command options.
 * @param {{includeDept: boolean}?} options
 */
export function getEmbedColorChoices({ includeDept = false } = {}) {
  const choices = [
    { name: "green", value: "Green" },
    { name: "blue", value: "Blue" },
    { name: "yellow", value: "Yellow" },
    { name: "purple", value: "Purple" },
    { name: "luminous_vivid_pink", value: "LuminousVividPink" },
    { name: "fuchsia", value: "Fuchsia" },
    { name: "gold", value: "Gold" },
    { name: "orange", value: "Orange" },
    { name: "red", value: "Red" },
    { name: "grey", value: "Grey" },
    { name: "navy", value: "Navy" },
    { name: "dark_aqua", value: "DarkAqua" },
    { name: "dark_green", value: "DarkGreen" },
    { name: "dark_blue", value: "DarkBlue" },
    { name: "dark_purple", value: "DarkPurple" },
    { name: "dark_vividpink", value: "DarkVividPink" },
    { name: "dark_gold", value: "DarkGold" },
    { name: "dark_orange", value: "DarkOrange" },
    { name: "dark_red", value: "DarkRed" },
    { name: "dark_grey", value: "DarkGrey" },
    { name: "darker_grey", value: "DarkerGrey" },
    { name: "light_grey", value: "LightGrey" },
    { name: "dark_navy", value: "DarkNavy" },
  ];

  if (includeDept) {
    choices.push({ name: "dept", value: "Dept" });
  }

  return choices;
}

/**
 * Split embed fields into embeds.
 */
export function pagedEmbed(embed, fields) {
  const data = splitArr(fields, 25);
  const pages = data.length;
  let page = 1;

  const embeds = [];

  for (const set of data) {
    const e = EmbedBuilder.from(embed);
    e.addFields(set);

    e.setFooter({ text: `Page ${page}/${pages}` });
    embeds.push(e);
    page++;
  }

  if (data.length === 0) embeds.push(embed);
  return embeds;
}

/**
 * Page Embeds
 */
export async function pagedEmbedButtons(interaction, embeds, content) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("paged_embed_back")
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("paged_embed_next")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Secondary),
  );

  row.components[0].setDisabled(true);
  let page = 0;
  const message = await interaction.editReply({
    content: content,
    embeds: [embeds[0]],
    components: [row],
  });

  const filter = i =>
    (i.customId === "paged_embed_back" || i.customId === "paged_embed_next") &&
    i.user.id === interaction.user.id;

  try {
    const collector = message.createMessageComponentCollector({
      filter,
      componentType: ComponentType.Button,
      time: 60000,
    });

    collector.on("collect", async i => {
      if (i.customId === "paged_embed_next") {
        page++;
      } else if (i.customId === "paged_embed_back") {
        page--;
      }

      if (page === 0) {
        row.components[0].setDisabled(true);
        row.components[1].setDisabled(false);
      } else if (page === embeds.length - 1) {
        row.components[0].setDisabled(false);
        row.components[1].setDisabled(true);
      } else {
        row.components[0].setDisabled(false);
        row.components[1].setDisabled(false);
      }

      await i.deferUpdate();
      await interaction.editReply({
        content: content,
        embeds: [embeds[page]],
        components: [row],
      });
    });

    collector.on("end", async () => {
      await clearReply(interaction, "Content expired.").catch(() => null);
    });
  } catch (e) {
    captureException(e, { module: "Util", function: "pagedEmbedButtons" });
  }
}

/**
 * Split array to a given size
 */
export function splitArr(arr, size) {
  return Array(Math.ceil(arr.length / size))
    .fill()
    .map((_, index) => index * size)
    .map(begin => arr.slice(begin, begin + size));
}

/**
 * Send a DM to a user, with automatic failure handling.
 * @param {Client} client - Discord client instance
 * @param {string} userId - User ID to send DM to
 * @param {string|Object} message - Message content or options object
 * @param {Object} options - Configuration options
 * @param {string} options.logPrefix - Optional prefix for console logs (e.g., "[Loa]")
 * @returns {Promise<boolean>} - Returns true if sent successfully, false otherwise
 */
export async function sendUserDM(client, userId, message, { logPrefix = "" } = {}) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(message);
    return true;
  } catch (error) {
    if (logPrefix) {
      console.warn(`${logPrefix} Failed to send DM to ${userId}:`, error.message);
    }
    return false;
  }
}

/**
 * Post an embed to the action_log_channel channel (if configured).
 * @param {Guild} guild - Discord guild instance
 * @param {Object} settings - Guild settings object
 * @param {EmbedBuilder} embed - Embed to post
 * @param {Object} options - Configuration options
 * @param {boolean} options.throwOnError - If true, throws on failure; if false, silently ignores (default: false)
 * @returns {Promise<Message|null>} - Returns the sent message or null on failure
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

export async function ensureGuildMembersCached(guild, { force = false } = {}) {
  const hasFetched = memberFetchTimestamps.has(guild.id);
  // A gateway reconnect rebuilds the guild from a partial GUILD_CREATE payload,
  // emptying the member cache while the timestamp still claims it is fresh.
  const cacheComplete = guild.members.cache.size >= guild.memberCount;
  const isFresh = !force && hasFetched && cacheComplete;

  if (isFresh) return;

  const inFlight = memberFetchPromises.get(guild.id);
  if (inFlight) {
    await inFlight;
    return;
  }

  const fetchPromise = guild.members.fetch().then(() => {
    memberFetchTimestamps.set(guild.id, Date.now());
  });

  memberFetchPromises.set(guild.id, fetchPromise);

  try {
    await fetchPromise;
  } finally {
    memberFetchPromises.delete(guild.id);
  }
}

export async function getMembersWithRole(guild, roleId, options) {
  await ensureGuildMembersCached(guild, options);

  const role = guild.roles.cache.get(roleId);
  if (!role) return [];

  return [...role.members.values()];
}

let closing = false;

/**
 * Gracefully shut down: log the client out, close the database connection, and exit.
 */
export async function close(client) {
  if (closing) return;
  closing = true;

  console.log("Shutting down...");

  // Force exit if shutdown hangs, before Docker's stop grace period sends SIGKILL.
  setTimeout(() => process.exit(1), 5000).unref();

  try {
    await client.destroy();
  } catch (e) {
    captureException(e, { module: "Util", function: "close" });
  }

  try {
    await db.close();
  } catch (e) {
    captureException(e, { module: "Util", function: "close" });
  }

  process.exit(0);
}
