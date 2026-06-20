import LeaveOfAbsence from "./module.js";
import ErrorHandler from "#modules/ErrorHandler";
import { Events } from "discord.js";

/**
 * Routes LOA approve/reject button interactions. Attaches its own
 * InteractionCreate listener so the base never needs to know about LOA buttons.
 */
export default client => {
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    const { customId } = interaction;
    if (!customId.startsWith("approve_loa_") && !customId.startsWith("reject_loa_")) return;

    try {
      const action = customId.startsWith("approve_loa_") ? "approve" : "reject";
      await LeaveOfAbsence.buttonInteraction(interaction, action);
    } catch (error) {
      await ErrorHandler.handleCommandError(interaction, error, {
        event: "ButtonInteraction",
        customId,
      });
    }
  });
};
