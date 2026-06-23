import Watchlist from "./module.js";
import { Events } from "discord.js";

/**
 * Watchlist lifecycle cleanup. Registers its own listener on the same event the
 * base handler uses; the base and feature listeners coexist on the EventEmitter.
 */
export default client => {
  client.on(Events.GuildDelete, async guild => {
    await Watchlist.cleanup({ guild_id: guild.id });
  });
};
