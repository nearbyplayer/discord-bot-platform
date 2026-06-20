/**
 * Discord bot entry point.
 * Initializes Sentry instrumentation, creates client, loads events, and starts bot.
 */
import "./instrument.js";

// Node Modules
import { Client, GatewayIntentBits } from "discord.js";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

// Modules
import { loadFeatures } from "#modules/Features";
import { close } from "#modules/Util";
import { botToken } from "#config";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Create Discord client with required intents
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// Graceful shutdown handlers
process.on("SIGTERM", () => close(client));
process.on("SIGINT", () => close(client));

// Dynamically load all event handlers
const eventFiles = readdirSync(join(__dirname, "events")).filter(file => file.endsWith(".js"));
for (const file of eventFiles) {
  const { default: handler } = await import(pathToFileURL(join(__dirname, "events", file)).href);
  handler(client);
}

// Discover features once and register their event handlers. Features attach to
// the same lifecycle events as the base handlers; ready.js reuses client.features
// for command and schedule registration. No-ops when there are no features.
client.features = await loadFeatures();
for (const feature of client.features) {
  for (const handler of feature.events ?? []) handler(client);
}

// Login to Discord
client.login(botToken);
