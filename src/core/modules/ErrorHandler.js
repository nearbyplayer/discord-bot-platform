import { captureException } from "#modules/Sentry";
import { clearReply } from "#modules/Util";
import { SystemError, UserError } from "#src/errors";
import { DiscordAPIError, MessageFlags, RESTJSONErrorCodes } from "discord.js";

/**
 * Centralized error handling for command execution.
 * Distinguishes between user errors and system errors for better UX.
 */
export default class ErrorHandler {
  /**
   * Handle a command execution error.
   * @param {import('discord.js').Interaction} interaction - Discord interaction
   * @param {Error} error - The error that occurred
   * @param {Object} [context] - Additional context for logging
   */
  static async handleCommandError(interaction, error, context = {}) {
    // Determine if this is a user error or system error
    const isUserError = error instanceof UserError;

    // Build error context for logging
    const errorContext = {
      ...context,
      command: interaction.commandName,
      guild: interaction.guild?.name,
      guildId: interaction.guild?.id,
      user: interaction.user.tag,
      userId: interaction.user.id,
      ...error.context,
    };

    if (isUserError) {
      // User errors: show message to user, log to console only
      console.error(`[UserError] ${error.name}: ${error.message}`, errorContext);
      await this.sendErrorReply(interaction, error.message);
    } else if (error instanceof DiscordAPIError) {
      // Routine Discord API failures (expired interactions, missing permissions,
      // deleted channels/messages) — console only, never Sentry.
      captureException(error, { ...errorContext, code: error.code });

      // The interaction token is dead; no reply is possible.
      if (error.code === RESTJSONErrorCodes.UnknownInteraction) return;

      const message =
        error.code === RESTJSONErrorCodes.MissingPermissions ||
        error.code === RESTJSONErrorCodes.MissingAccess
          ? "The bot is missing the Discord permissions needed to complete that action. Please check its role and channel permissions."
          : `Discord returned an error while executing that command: ${error.message}`;
      await this.sendErrorReply(interaction, message);
    } else {
      // System errors: show generic message, log to Sentry
      const systemError =
        error instanceof SystemError
          ? error
          : new SystemError("An unexpected error occurred", error, errorContext);

      // Log to Sentry with full context
      if (systemError.originalError) {
        captureException(systemError.originalError, errorContext, { report: true });
      } else {
        captureException(systemError, errorContext, { report: true });
      }

      // Show generic error to user
      await this.sendErrorReply(
        interaction,
        "There was an error while executing that command. The issue has been logged.",
      );
    }
  }

  /**
   * Send an error reply to the user.
   * Handles both deferred and non-deferred interactions.
   * @param {import('discord.js').Interaction} interaction - Discord interaction
   * @param {string} message - Error message to show
   */
  static async sendErrorReply(interaction, message) {
    try {
      if (interaction.deferred || interaction.replied) {
        await clearReply(interaction, message);
      } else {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: message,
          components: [],
          embeds: [],
        });
      }
    } catch (replyError) {
      // If we can't send the error message, log it but don't throw
      console.error("Failed to send error reply:", replyError);
    }
  }

  /**
   * Optional wrapper for command execute functions to avoid try-catch boilerplate.
   * Usage: execute: ErrorHandler.wrapHandler(async (i) => { ... })
   * @param {Function} handler - The command execute function
   * @returns {Function} Wrapped handler with error handling
   */
  static wrapHandler(handler) {
    return async interaction => {
      try {
        await handler(interaction);
      } catch (error) {
        await this.handleCommandError(interaction, error, {
          wrapped: true,
        });
      }
    };
  }
}
