/**
 * Watchlist feature manifest.
 * Auto-discovered by the feature loader; contributes a command, lifecycle
 * cleanup, the watchlist notification schedule, and its own settings field.
 */
import command from "./command.js";
import cleanup from "./cleanup.js";
import * as schedule from "./schedule.js";

export default {
  name: "watchlist",
  commands: [command],
  events: [cleanup],
  schedules: [schedule],
  // The watchlist notification channel, merged into the base settings schema by
  // buildSettingsModel.
  settings: {
    watchlist_channel: { type: String, default: "" },
  },
};
