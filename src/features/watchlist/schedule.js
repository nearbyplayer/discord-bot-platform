import WLSchema from "./schema.js";
import { findPlayerInGame } from "#features/ingame/lookup";
import { captureException } from "#modules/Sentry";
import { pagedEmbed } from "#modules/Util";
import { ConfigError, UserError } from "#src/errors";
import { EmbedBuilder } from "discord.js";

export const name = "watchlist";
export const schedule = "0 */5 * * * *";
export const runOnStart = false;

/**
 * @param {import('discord.js').Client} client
 */
export async function execute(client) {
  if (!client.logs?.cache?.length) return;

  for (const guild of client.guilds.cache.values()) {
    try {
      if (!client.settings.requires(guild, "watchlist_channel")) continue;
      const settings = client.settings.get(guild);

      const channel = await guild.channels.fetch(settings?.watchlist_channel).catch(() => null);
      if (!channel) {
        throw new ConfigError("Watchlist channel is invalid or inaccessible.", {
          channel_id: settings?.watchlist_channel,
        });
      }

      const wlEntries = await WLSchema.find({ guild_id: guild.id }).exec();
      if (wlEntries.length === 0) continue;

      const fields = [];

      for (const wl of wlEntries) {
        const match = findPlayerInGame(client.logs.cache, wl.target);
        if (!match) continue;

        const players = match.server.Information?.Players ?? [];
        fields.push({
          name: `${wl.target} (${players.length}/60)`,
          value: `[Profile](https://www.roblox.com/user.aspx?username=${wl.target})`,
        });
      }

      if (fields.length === 0) continue;

      const embed = new EmbedBuilder()
        .setTitle("Watchlist Notification")
        .setColor(settings?.color ?? "#000000");

      const embeds = pagedEmbed(embed, fields);
      await channel.send({ embeds }).catch(() => {});
    } catch (e) {
      // Config errors (e.g. deleted watchlist channel) recur every run — console only.
      captureException(
        e,
        { module: "watchlist", function: "execute", guild_id: guild.id },
        { report: !(e instanceof UserError) },
      );
    }
  }
}
