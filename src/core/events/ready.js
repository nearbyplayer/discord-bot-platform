// Node Modules
import { Collection, Events } from "discord.js";
import cron from "node-cron";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Modules
import { captureException } from "#modules/Sentry";

/**
 * Bot initialization on ready event.
 * Runs data migrations, initializes capabilities (db/settings/permissions),
 * then loads schedules and commands from the kernel plus every manifest.
 */
export default client => {
  client.once(Events.ClientReady, async () => {
    console.clear();
    console.log(`Logged in as ${client.user.tag}!`);

    const capabilities = client.capabilities ?? [];
    const features = client.features ?? [];
    const manifests = [...capabilities, ...features];

    // Run data migrations once, before settings load, so relocated fields are
    // read from their new paths. The kernel owns this seam, so migrations run
    // regardless of which capabilities are present.
    for (const manifest of manifests) {
      if (typeof manifest.migrate === "function") await manifest.migrate();
    }

    // Initialize capabilities in load order (db -> permissions -> settings).
    // Their init hooks fill the kernel seams: db registers teardown, permissions
    // registers the resolver (role lookup is lazy, so it needs no settings yet),
    // settings builds the model + cache and pushes the guild-init gate. A
    // capability failing to init is fatal.
    for (const capability of capabilities) {
      if (typeof capability.init === "function") await capability.init(client);
    }

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

    // Register manifest-provided schedules (capabilities + features)
    for (const manifest of manifests) {
      for (const descriptor of manifest.schedules ?? []) {
        await registerSchedule(descriptor, manifest.name);
      }
    }

    // Initialize cooldown tracking
    client.cooldowns = new Collection();

    // Register a command into the collection, validating its shape.
    // A command may export `build(manifests)` instead of a static `data` when its
    // shape depends on the loaded manifests (e.g. the /config assembler). The
    // kernel resolves it generically here without knowing which command opts in.
    const registerCommand = (command, label) => {
      if (command && typeof command.build === "function" && !command.data) {
        command.data = command.build(manifests);
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

    client.commands = new Collection();

    // Load kernel commands from src/core/commands (the kernel may ship none).
    const commandsPath = join(process.cwd(), "src", "core", "commands");
    if (existsSync(commandsPath)) {
      const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith(".js"));
      for (const file of commandFiles) {
        const { default: command } = await import(pathToFileURL(join(commandsPath, file)).href);
        registerCommand(command, file);
      }
    }

    // Register manifest-provided commands (capabilities + features)
    for (const manifest of manifests) {
      for (const command of manifest.commands ?? []) {
        registerCommand(command, manifest.name);
      }
    }

    // Run feature one-time init hooks (capabilities already initialized above).
    for (const feature of features) {
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
