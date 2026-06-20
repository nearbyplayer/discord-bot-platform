/**
 * Guild settings schema.
 * Base configuration only. Features contribute their own settings fields via the
 * `settings` fragment on their manifest; `buildSettingsModel` merges those
 * fragments into the schema before the model is compiled, so the base schema
 * never names a feature. See the Feature System section in CLAUDE.md.
 */
import db from "#db";
import { Schema } from "mongoose";

/**
 * Compile the settings model, merging any feature-provided schema fragments.
 * Idempotent: a Mongoose model name can only be compiled once per connection,
 * so subsequent calls return the already-compiled model.
 * @param {Array<{ settings?: object }>} [features] - Loaded feature manifests
 * @returns {import('mongoose').Model}
 */
export function buildSettingsModel(features = []) {
  if (db.models.settings) return db.models.settings;

  const schema = new Schema(
    {
      guild_id: { type: String, required: true },
      action_log_channel: { type: String, default: "" },
      color: { type: String, default: "" },
      roles: {
        type: new Schema(
          {
            employee: { type: [String], default: [] },
            command: { type: [String], default: [] },
            high: { type: [String], default: [] },
            ia: { type: [String], default: [] },
          },
          { _id: false },
        ),
        default: () => ({}),
      },
    },
    { collection: "settings", versionKey: false },
  );

  // Merge feature-provided settings fragments (top-level paths).
  for (const feature of features) {
    if (feature.settings) schema.add(feature.settings);
  }

  schema.index({ guild_id: 1 }, { unique: true });

  return db.model("settings", schema, "settings");
}
