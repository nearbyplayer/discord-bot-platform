import AutoLogs from "./module.js";
import { Events } from "discord.js";

/**
 * Auto-log lifecycle cleanup. Registers its own listeners on the same events the
 * base handlers use - discord.js clients are EventEmitters, so the base and
 * feature listeners coexist. Removing this feature removes its cleanup with it.
 */
export default client => {
  client.on(Events.GuildDelete, async guild => {
    await AutoLogs.cleanup({ guild_id: guild.id });
  });
  client.on(Events.GuildMemberRemove, async member => {
    await AutoLogs.cleanup({ guild_id: member.guild.id, discord_id: member.id });
  });
};
