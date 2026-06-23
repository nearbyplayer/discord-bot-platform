/**
 * Watchlist schema.
 * Tracks Roblox usernames to be alerted about when found in-game.
 */
import db from "#db";
import { Schema } from "mongoose";

const schema = new Schema(
  {
    username: { type: String, required: true },
    guild_id: { type: String, required: true },
    discord_id: { type: String, required: true },
    target: { type: String, required: true },
    reason: { type: String, required: true },
  },
  { collection: "watchlists", versionKey: false },
);

schema.index({ guild_id: 1 });
schema.index({ guild_id: 1, target: 1 }, { unique: true });

export default db.model("watchlist", schema, "watchlists");
