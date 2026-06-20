/**
 * Auto-log feature manifest.
 * Auto-discovered by the feature loader; contributes a command, lifecycle
 * cleanup, the in-game polling schedule, and its own settings fields.
 */
import command from "./command.js";
import cleanup from "./cleanup.js";
import * as schedule from "./schedule.js";
import db from "#db";
import { Schema } from "mongoose";

export default {
  name: "autolog",
  commands: [command],
  events: [cleanup],
  schedules: [schedule],
  // Auto-log keeps its in-game team acronym under its own settings namespace,
  // merged into the base settings schema by buildSettingsModel.
  settings: {
    autolog: {
      type: new Schema({ team: { type: String, default: "" } }, { _id: false }),
      default: () => ({}),
    },
  },
  // One-time relocation of the legacy `logs.team` field to `autolog.team`.
  // Idempotent: after the first run no documents match the filter.
  async migrate() {
    await db
      .collection("settings")
      .updateMany({ "logs.team": { $exists: true } }, { $rename: { "logs.team": "autolog.team" } });
  },
};
