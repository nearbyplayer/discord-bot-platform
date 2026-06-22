/**
 * Guild settings schema (settings capability).
 * Base configuration only. Capabilities and features contribute their own fields
 * via the `settings` fragment on their manifest; `buildSettingsModel` merges
 * those fragments into the schema before the model is compiled, so the base
 * schema never names a feature.
 */
import db from "#db";
import { Schema } from "mongoose";

/**
 * Compile the settings model, merging any manifest-provided schema fragments.
 * Idempotent: a Mongoose model name can only be compiled once per connection,
 * so subsequent calls return the already-compiled model.
 * @param {Array<{ settings?: object }>} [manifests] - Loaded capability/feature manifests
 * @returns {import('mongoose').Model}
 */
export function buildSettingsModel(manifests = []) {
  if (db.models.settings) return db.models.settings;

  const schema = new Schema(
    {
      guild_id: { type: String, required: true },
      color: { type: String, default: "" },
    },
    { collection: "settings", versionKey: false },
  );

  // Merge manifest-provided settings fragments (top-level paths).
  for (const manifest of manifests) {
    if (manifest.settings) schema.add(manifest.settings);
  }

  schema.index({ guild_id: 1 }, { unique: true });

  return db.model("settings", schema, "settings");
}
