/**
 * In-game tracking configuration from environment variables.
 * Drives the Roblox server-data API used by auto logs and the watchlist.
 * `enabled` is derived from AUTO_LOG_API_URL being set.
 */
export const autoLog = {
  apiKey: process.env.AUTO_LOG_API_KEY || "",
  apiUrl: process.env.AUTO_LOG_API_URL || "",
  enabled: Boolean(process.env.AUTO_LOG_API_URL),
};
