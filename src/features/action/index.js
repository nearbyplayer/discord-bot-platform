/**
 * Action feature manifest.
 * Auto-discovered by the feature loader; contributes the /action command and
 * the /config action subcommand. Action has no database records, no buttons,
 * and no schedules - it lives entirely in settings and command logic.
 */
import command from "./command.js";
import config from "./config.js";

export default {
  name: "action",
  commands: [command],
  config,
  // Action keeps its request channel and IA acronym under its own settings
  // namespace, merged into the base settings schema by buildSettingsModel.
  settings: {
    action_requests_channel: { type: String, default: "" },
    ia_acronym: { type: String, default: "" },
  },
};
