// Sentry logging utility
import { captureException as sentryCaptureException } from "@sentry/node";
import { nodeEnv } from "#config";

/**
 * Log an error, optionally reporting it to Sentry.
 * Sentry reporting is opt-in (`report: true`) and reserved for egregious failures
 * such as database errors or broken code. Routine failures (Discord API flakiness,
 * misconfigured guilds, transient network errors) stay in the console.
 * @param {Error} err - The error to log
 * @param {Object} [context] - Additional context attached to the log/report
 * @param {{report?: boolean}} [options] - Set report: true to send to Sentry in production
 */
export function captureException(err, context = {}, { report = false } = {}) {
  console.error("Error:", err, context);
  if (!report || nodeEnv !== "production") return;
  sentryCaptureException(err, { extra: context });
}
