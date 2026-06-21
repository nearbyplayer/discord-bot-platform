/**
 * Pager feature manifest.
 * Auto-discovered by the feature loader; contributes the /pager command, the
 * /config pager subcommand, and its own settings fields.
 * Pagers have no database records - they live entirely in guild settings.
 */
import command from "./command.js";
import config from "./config.js";
import { Schema } from "mongoose";

export default {
  name: "pager",
  commands: [command],
  config,
  // Pager keeps its type→{channel,role} map under its own settings namespace,
  // merged into the base settings schema by buildSettingsModel.
  settings: {
    pagers: {
      type: Map,
      of: new Schema({
        channel: String,
        role: String,
      }),
      default: () => new Map(),
    },
  },
};
