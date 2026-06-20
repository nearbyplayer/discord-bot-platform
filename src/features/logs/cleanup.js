import Logs from "./module.js";
import { Events } from "discord.js";

/**
 * Logs lifecycle cleanup. Registers its own listeners on the same events the base
 * handlers use — discord.js clients are EventEmitters, so base and feature
 * listeners coexist. Removing this feature removes its cleanup with it.
 */
export default client => {
  client.on(Events.GuildDelete, async guild => {
    await Logs.cleanup({ guild_id: guild.id });
  });
  client.on(Events.GuildMemberRemove, async member => {
    await Logs.cleanup({ guild_id: member.guild.id, discord_id: member.id });
  });
};
