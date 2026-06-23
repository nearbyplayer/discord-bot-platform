/**
 * Activity log schema.
 * Stores user activity logs with date, time, duration, and screenshots.
 * Supports both regular activity logs and special unit-specific logs.
 */
import db from "#db";
import { Schema } from "mongoose";

const schema = new Schema(
  {
    username: {
      type: String,
      required: true,
    },
    guild_id: {
      type: String,
      required: true,
    },
    discord_id: {
      type: String,
      required: true,
    },
    start_image: {
      type: String,
      required: false,
    },
    start_time: {
      type: String,
      required: true,
    },
    end_image: {
      type: String,
      required: false,
    },
    end_time: {
      type: String,
      required: true,
    },
    duration: {
      type: Number,
      required: true,
    },
    date: {
      type: String,
      required: true,
    },
    flagged: {
      type: String,
      required: false,
    },
    bot_verified: {
      type: Boolean,
      required: false,
    },
    is_special: {
      type: Boolean,
      required: false,
    },
    special_for: {
      type: String,
      required: false,
    },
  },
  { collection: "logs", versionKey: false },
);

schema.index({ guild_id: 1 });
schema.index({ guild_id: 1, discord_id: 1 });

// Export Model
export default db.model("log", schema, "logs");
