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
import { loadCapabilities, loadFeatures } from "#modules/Features";
import { close } from "#modules/Util";
import { botToken } from "#config";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Create Discord client with required intents
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// Kernel seams - filled by capabilities/features (see docs/architecture/capability-tier.md).
// Initialized here so they exist before any interaction or shutdown signal arrives.
client.gates = []; // interaction preconditions: (interaction, command) => blockMessage | null
client.shutdownHooks = []; // async teardown callbacks run by close()
client.permissions = null; // resolver: { has, checkSubcommandPermission, getPermissionError }

// Graceful shutdown handlers
process.on("SIGTERM", () => close(client));
process.on("SIGINT", () => close(client));

// Dynamically load all event handlers
const eventFiles = readdirSync(join(__dirname, "events")).filter(file => file.endsWith(".js"));
for (const file of eventFiles) {
  const { default: handler } = await import(pathToFileURL(join(__dirname, "events", file)).href);
  handler(client);
}

// Discover capabilities and features once and register their event handlers.
// Capabilities (db/settings/permissions) load first and fill kernel seams in
// their init hooks; both tiers attach to the same lifecycle events as the base
// handlers. ready.js reuses these lists for migrate/command/schedule/init
// registration. No-ops when a tier ships empty.
client.capabilities = await loadCapabilities();
client.features = await loadFeatures();
for (const manifest of [...client.capabilities, ...client.features]) {
  for (const handler of manifest.events ?? []) handler(client);
}

// Login to Discord
client.login(botToken);
