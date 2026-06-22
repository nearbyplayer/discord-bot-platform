/**
 * Settings capability.
 * Owns the per-guild settings model + cache (the `Settings` module), the
 * `/config` assembler command, and the guild-init gate. Requires the db
 * capability. Opt-in: bots that use static config never entitle it.
 */
import config from "./config.js";
import Settings from "./Settings.js";

export default {
  name: "settings",
  commands: [config],
  init: async client => {
    client.settings = new Settings(client);
    await client.settings.initialize();

    // Guild-init gate: block commands in guilds that haven't run /config init
    // (except /config itself). Registered into the kernel's interaction gate seam.
    client.gates.push((interaction, command) =>
      command.data.name !== "config" && !client.settings.has(interaction.guild)
        ? "This guild has not been initialized yet."
        : null,
    );
  },
};
