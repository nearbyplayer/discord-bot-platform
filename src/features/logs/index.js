/**
 * Logs (activity-log quota) feature manifest.
 * Auto-discovered by the feature loader; contributes the /log command, the
 * /config logs subcommand, lifecycle cleanup, the member-cache init hook,
 * and its own settings fields.
 */
import command from "./command.js";
import config from "./config.js";
import cleanup from "./cleanup.js";
import init from "./init.js";
import { Schema } from "mongoose";

export default {
  name: "logs",
  commands: [command],
  events: [cleanup],
  config,
  init,
  // Logs keeps its quota/channel/exempt config under its own settings namespace,
  // merged into the base settings schema by buildSettingsModel.
  settings: {
    logs: {
      type: new Schema(
        {
          active: { type: Boolean, default: false },
          channel: { type: String, default: "" },
          quota: {
            type: Map,
            of: new Schema(
              {
                priority: Number,
                count: Number,
                time: Number,
              },
              { _id: false },
            ),
            default: () => new Map(),
          },
          special_quota: {
            type: Map,
            of: new Schema(
              {
                count: Number,
                time: Number,
              },
              { _id: false },
            ),
            default: () => new Map(),
          },
          exempt: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
  },
};
