/**
 * LOA (Leave of Absence) tracking schema.
 * Stores all LOA requests with status tracking from pending to expired.
 */
import { Schema } from "mongoose";
import db from "#db";

const schema = new Schema(
  {
    guild_id: {
      required: true,
      type: String,
    },
    discord_id: {
      required: true,
      type: String,
    },
    member_name: {
      required: true,
      type: String,
    },
    unit_id: {
      required: false,
      type: String,
      default: "",
    },
    unit_name: {
      required: false,
      type: String,
      default: "",
    },
    reason: {
      required: true,
      type: String,
    },
    start: {
      required: true,
      type: String,
    },
    end: {
      required: true,
      type: String,
    },
    approved_by: {
      required: false,
      type: String,
      default: "",
    },
    approved: {
      required: false,
      default: false,
      type: Boolean,
    },
    message_id: {
      type: String,
    },
  },
  { collection: "loa_requests", versionKey: false },
);

// Export Model
export default db.model("loa", schema, "loa_requests");
