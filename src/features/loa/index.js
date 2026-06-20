/**
 * LOA (Leave of Absence) feature manifest.
 * Auto-discovered by the feature loader; contributes the /loa command, the
 * /config loa subcommand, button routing, lifecycle cleanup, the daily LOA
 * cron, and its own settings fields.
 */
import command from "./command.js";
import config from "./config.js";
import cleanup from "./cleanup.js";
import events from "./events.js";
import * as schedule from "./schedule.js";
import { Schema } from "mongoose";

export default {
  name: "loa",
  commands: [command],
  events: [cleanup, events],
  schedules: [schedule],
  config,
  // LOA keeps its request channel + role under its own settings namespace,
  // merged into the base settings schema by buildSettingsModel.
  settings: {
    loa: {
      type: new Schema(
        {
          channel: { type: String, default: "" },
          role: { type: String, default: "" },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
  },
};
