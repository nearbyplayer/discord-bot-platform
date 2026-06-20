import { Events } from "discord.js";

export default client => {
  client.on(Events.GuildDelete, async guild => {
    await client.settings.remove(guild.id);
  });
};
