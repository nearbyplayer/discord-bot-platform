/**
 * Bot configuration from environment variables.
 * Supports production and test environments.
 */

export const nodeEnv = process.env.NODE_ENV || "production";
export const clientId = process.env.CLIENT_ID;
export const botToken = process.env.BOT_TOKEN;
export const owners = ["955691339629088819", "109075895834136576"]; // Antradz, nearbyplayer
export const mongo = process.env.MONGO || "";
export const game = {
  name: process.env.GAME_NAME || "",
  id: process.env.GAME_ID || "",
};
