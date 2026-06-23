import WLSchema from "./schema.js";
import { findPlayerInGame } from "#apps/department/ingame/lookup";
import { captureException } from "#modules/Sentry";
import { DatabaseError, ValidationError } from "#src/errors";
import { EmbedBuilder } from "discord.js";

/**
 * Watchlist management and in-game lookup.
 */
export default {
  /**
   * Check if a Roblox username is currently in-game.
   */
  async check(i) {
    const username = i.options.getString("username");

    if (!i.client.logs?.cache?.length) {
      throw new ValidationError("Game data is not available yet, try again in a moment.");
    }

    let found = `${username} was not found in any servers.`;

    const match = findPlayerInGame(i.client.logs.cache, username);
    if (match) {
      const players = match.server.Information?.Players ?? [];
      found = `${match.player.Username} was found in a ${players.length}/60 player server with job ID \`${match.server.JobID}\`.`;
    }

    await i.editReply(found);
  },
  /**
   * Add a Roblox username to the watchlist.
   */
  async add(i) {
    const username = i.options.getString("username");
    const reason = i.options.getString("reason");

    const exists = await WLSchema.findOne({ guild_id: i.guild.id, target: username }).exec();
    if (exists) throw new ValidationError("A watchlist entry for that user already exists.");

    const wl = new WLSchema({
      username: i.member.displayName,
      guild_id: i.guild.id,
      discord_id: i.member.id,
      target: username,
      reason,
    });

    try {
      await wl.save();
    } catch (e) {
      throw new DatabaseError("Failed to add watchlist entry.", e, {
        module: "Watchlist",
        function: "add",
      });
    }

    return i.editReply(`Successfully added \`${username}\` to the watchlist.`);
  },
  /**
   * Remove a Roblox username from the watchlist.
   */
  async remove(i) {
    const username = i.options.getString("username");

    const wl = await WLSchema.findOne({ target: username, guild_id: i.guild.id }).exec();
    if (!wl) throw new ValidationError("No watchlist entry was found for that user.");

    try {
      await WLSchema.deleteOne({ _id: wl._id }).exec();
    } catch (e) {
      throw new DatabaseError("Failed to remove watchlist entry.", e, {
        module: "Watchlist",
        function: "remove",
      });
    }

    return i.editReply(`Successfully removed \`${username}\` from the watchlist.`);
  },
  /**
   * View a watchlist entry.
   */
  async view(i) {
    const username = i.options.getString("username");

    const wl = await WLSchema.findOne({ target: username, guild_id: i.guild.id }).exec();
    if (!wl) throw new ValidationError("No watchlist entry was found for that user.");

    const settings = i.client.settings.get(i.guild);
    const embed = new EmbedBuilder().setTitle("Watchlist Entry").setColor(settings.color);
    embed.addFields(
      { name: "Investigator", value: wl.username },
      { name: "Target", value: username },
      { name: "Reason", value: wl.reason },
    );

    await i.editReply({ embeds: [embed] });
  },
  /**
   * Clean up all watchlist entries for a guild.
   * @param {{guild_id: string}} filter
   */
  async cleanup(filter) {
    try {
      await WLSchema.deleteMany(filter).exec();
    } catch (error) {
      captureException(
        error,
        { module: "Watchlist", function: "cleanup", ...filter },
        { report: true },
      );
    }
  },
};
