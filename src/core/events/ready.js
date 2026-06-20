// Node Modules
import { Collection, Events } from "discord.js";
import cron from "node-cron";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Modules
import { captureException } from "#modules/Sentry";
import Settings from "#modules/Settings";

/**
 * Bot initialization on ready event.
 * Loads guild settings and commands from filesystem.
 */
export default client => {
  client.once(Events.ClientReady, async () => {
    console.clear();
    console.log(`Logged in as ${client.user.tag}!`);

    // Load guild settings from database
    client.settings = new Settings(client);
    await client.settings.initialize();

    // Register a schedule descriptor { name, schedule, runOnStart, execute }.
    // An error escaping a schedule must not become an unhandled rejection and kill the bot.
    const registerSchedule = async ({ name, schedule, runOnStart, execute }, label) => {
      const run = async () => {
        try {
          await execute(client);
        } catch (error) {
          captureException(
            error,
            { event: "ClientReady", schedule: name ?? label },
            { report: true },
          );
        }
      };
      cron.schedule(schedule, run);
      if (runOnStart) await run();
      console.log(`Loaded schedule: ${name ?? label}`);
    };

    // Auto-discover and register schedules from src/core/schedules
    const schedulesPath = join(process.cwd(), "src", "core", "schedules");
    if (existsSync(schedulesPath)) {
      const scheduleFiles = readdirSync(schedulesPath).filter(file => file.endsWith(".js"));
      for (const file of scheduleFiles) {
        const descriptor = await import(pathToFileURL(join(schedulesPath, file)).href);
        await registerSchedule(descriptor, file);
      }
    }

    // Register feature-provided schedules
    for (const feature of client.features ?? []) {
      for (const descriptor of feature.schedules ?? []) {
        await registerSchedule(descriptor, feature.name);
      }
    }

    // Initialize cooldown tracking
    client.cooldowns = new Collection();

    // Register a command into the collection, validating its shape.
    // A command may export `build(features)` instead of a static `data` when its
    // shape depends on the loaded features (e.g. the config assembler). The base
    // resolves it generically here without knowing which command opts in.
    const registerCommand = (command, label) => {
      if (command && typeof command.build === "function" && !command.data) {
        command.data = command.build(client.features ?? []);
      }
      if (command && "data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
      } else {
        const err = new Error(
          `The command at ${label} is missing a required "data" or "execute" property.`,
        );
        captureException(err, { event: "ClientReady", file: label }, { report: true });
      }
    };

    // Dynamically load all commands from src/core/commands
    const commandsPath = join(process.cwd(), "src", "core", "commands");
    const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith(".js"));
    client.commands = new Collection();

    for (const file of commandFiles) {
      const { default: command } = await import(pathToFileURL(join(commandsPath, file)).href);
      registerCommand(command, file);
    }

    // Register feature-provided commands
    for (const feature of client.features ?? []) {
      for (const command of feature.commands ?? []) {
        registerCommand(command, feature.name);
      }
    }

    // Run feature one-time init hooks (settings + commands are ready).
    for (const feature of client.features ?? []) {
      if (typeof feature.init === "function") {
        try {
          await feature.init(client);
        } catch (error) {
          captureException(
            error,
            { event: "ClientReady", feature: feature.name, action: "init" },
            { report: true },
          );
        }
      }
    }
  });
};
