import { Collection, Events, MessageFlags } from "discord.js";
// Modules
import ErrorHandler from "#modules/ErrorHandler";
import { clearReply } from "#modules/Util";

/**
 * Handles slash command interactions.
 * Flow: validation → settings check → permission check → cooldown → execute → error handling
 */
export default client => {
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const {
      client: { commands, cooldowns },
      commandName,
    } = interaction;

    // Interactions can arrive before ClientReady has finished loading commands.
    if (!commands || !cooldowns) {
      return interaction
        .reply({
          content: "The bot is still starting up, please try again in a moment.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    // The token may already be expired (gateway lag); if deferring fails,
    // nothing can be sent for this interaction.
    const deferred = await interaction
      .deferReply({ flags: MessageFlags.Ephemeral })
      .then(() => true)
      .catch(() => false);
    if (!deferred) return;

    const command = commands.get(commandName);

    if (!command) return interaction.editReply("That command hasn't been set up yet.");

    // Interaction gates — preconditions registered by capabilities/features
    // (e.g. the settings capability's guild-init check). First non-null message blocks.
    for (const gate of interaction.client.gates ?? []) {
      const block = await gate(interaction, command);
      if (block) return interaction.editReply(block);
    }

    const permissions = interaction.client.permissions;
    if (command.permissions && permissions) {
      const requiredLevel = permissions.checkSubcommandPermission(command, interaction);
      if (requiredLevel && !permissions.has(interaction.member, requiredLevel)) {
        return interaction.editReply(permissions.getPermissionError(requiredLevel));
      }
    }

    // Cooldown system (default 5 seconds)
    if (!cooldowns.has(command.data.name)) cooldowns.set(command.data.name, new Collection());
    const now = Date.now();
    const timestamps = cooldowns.get(command.data.name);
    const cooldownAmount = (command.cooldown ?? 5) * 1_000;

    if (timestamps.has(interaction.user.id)) {
      const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        return clearReply(
          interaction,
          `Please wait ${timeLeft.toFixed(1)} more second(s) before reusing the \`${command.data.name}\` command.`,
        );
      }
    }

    try {
      await command.execute(interaction);
    } catch (e) {
      await ErrorHandler.handleCommandError(interaction, e, { event: "InteractionCreate" });
    } finally {
      timestamps.set(interaction.user.id, now);
      setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
    }
  });
};
