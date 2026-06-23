/**
 * Active in-game log schema.
 * Tracks currently active in-game logging sessions.
 */
import db from "#db";
import { Schema } from "mongoose";

const schema = new Schema(
  {
    special_for: { type: String },
    last_active: { type: String, required: true },
    is_special: { type: Boolean, required: true },
    discord_id: { type: String, required: true },
    guild_id: { type: String, required: true },
    username: { type: String, required: true },
    start: { type: String, required: true },
    team: { type: String, required: true },
  },
  { collection: "active_logs", versionKey: false },
);

schema.index({ guild_id: 1 });
schema.index({ guild_id: 1, discord_id: 1 });

export default db.model("active_log", schema, "active_logs");
