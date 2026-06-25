/**
 * Deploy Commands Manager
 * Reads BOT_TOKEN and CLIENT_ID from environment (via .env in the bot's root).
 * Commands come from every loaded manifest (capabilities + apps/features) plus any
 * kernel commands - run this from the bot's root directory. Mirrors ready.js.
 */
import { REST } from "@discordjs/rest";
import chalk from "chalk";
import { Routes } from "discord.js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { loadCapabilities, loadFeatures } from "#modules/Features";

const botToken = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!botToken || !clientId) {
  console.error("Missing BOT_TOKEN or CLIENT_ID in environment.");
  process.exit(1);
}

// Manifests (capabilities + apps/features) are needed before building commands:
// a command may export `build(manifests)` instead of a static `data` when its
// shape depends on the loaded manifests (e.g. the /config assembler, shipped by
// the settings capability). Resolve that seam the same way ready.js does.
const capabilities = await loadCapabilities();
const features = await loadFeatures();
const manifests = [...capabilities, ...features];

const resolveData = command => command.data ?? command.build(manifests);

const commands = [];

// Kernel commands, if any (the kernel may ship none — /config lives in a capability).
const commandsPath = join(process.cwd(), "src", "core", "commands");
if (existsSync(commandsPath)) {
  const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith(".js"));
  for (const file of commandFiles) {
    const { default: command } = await import(pathToFileURL(join(commandsPath, file)).href);
    commands.push(resolveData(command).toJSON());
  }
}

// Include manifest-provided commands (capabilities + features) so they deploy together.
for (const manifest of manifests) {
  for (const command of manifest.commands ?? []) {
    commands.push(resolveData(command).toJSON());
  }
}

const rest = new REST({ version: "10" }).setToken(botToken);

const log = {
  info: msg => console.log(`  ${chalk.cyan("info")}  ${msg}`),
  ok: msg => console.log(`  ${chalk.green("ok")}    ${msg}`),
  warn: msg => console.log(`  ${chalk.yellow("warn")}  ${msg}`),
  err: msg => console.log(`  ${chalk.red("err")}   ${msg}`),
};

async function globalWipe() {
  log.warn("Wiping all global commands...");
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    log.ok("Global commands wiped.");
  } catch (error) {
    log.err(`Failed: ${error.message}`);
  }
}

async function globalUpdate() {
  log.info(`Deploying ${chalk.bold(commands.length)} global command(s)...`);
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    log.ok(`${commands.length} global command(s) deployed.`);
  } catch (error) {
    log.err(`Failed: ${error.message}`);
  }
}

async function getGuilds() {
  return rest.get(Routes.userGuilds()).catch(() => undefined);
}

async function guildWipe() {
  const guilds = await getGuilds();
  if (!guilds) return log.err("Couldn't fetch guilds.");
  log.warn(`Wiping all commands from ${chalk.bold(guilds.length)} guild(s)...`);
  for (const guild of guilds) {
    if (!guild.id) continue;
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
      log.ok(`Wiped ${chalk.dim(guild.name ?? guild.id)}`);
    } catch (error) {
      log.err(`${guild.name ?? guild.id}: ${error.message}`);
    }
  }
}

async function guildUpdate() {
  const guilds = await getGuilds();
  if (!guilds) return log.err("Couldn't fetch guilds.");
  log.info(`Deploying to ${chalk.bold(guilds.length)} guild(s)...`);
  for (const guild of guilds) {
    if (!guild.id) continue;
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: commands });
      log.ok(`Deployed to ${chalk.dim(guild.name ?? guild.id)}`);
    } catch (error) {
      log.err(`${guild.name ?? guild.id}: ${error.message}`);
    }
  }
}

async function listGuilds() {
  const guilds = await getGuilds();
  if (!guilds) return log.err("Couldn't fetch guilds.");
  if (guilds.length === 0) return log.info("Bot is not in any guilds.");
  console.log();
  console.log(`  ${chalk.bold(`${guilds.length} guild(s):`)}`);
  for (const guild of guilds) {
    console.log(`  ${guild.name ?? chalk.dim("(unknown)")}  ${chalk.dim(guild.id)}`);
  }
}

async function leaveGuild(rl) {
  const guildId = (await prompt(rl, `  ${chalk.magenta("Guild ID to leave:")} `)).trim();
  if (!guildId) return log.warn("No ID entered.");
  try {
    await rest.delete(Routes.userGuild(guildId));
    log.ok(`Left guild ${chalk.bold(guildId)}.`);
  } catch (error) {
    log.err(`Failed: ${error.message}`);
  }
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function printMenu() {
  console.clear();
  console.log(chalk.cyan.bold("╔══════════════════════════════════╗"));
  console.log(chalk.cyan.bold("║     Deploy Commands Manager      ║"));
  console.log(chalk.cyan.bold("╚══════════════════════════════════╝"));
  console.log(`  ${chalk.dim(`${commands.length} command(s) loaded`)}`);
  console.log();
  console.log(`  ${chalk.bold("1.")} Global Update`);
  console.log(`  ${chalk.bold("2.")} Global Wipe`);
  console.log(`  ${chalk.bold("3.")} Guild Update`);
  console.log(`  ${chalk.bold("4.")} Guild Wipe`);
  console.log(`  ${chalk.bold("5.")} Guild List`);
  console.log(`  ${chalk.bold("6.")} Guild Leave`);
  console.log(`  ${chalk.bold("7.")} Exit`);
  console.log();
}

async function confirmWipe(rl, scope) {
  const answer = (
    await prompt(rl, `  ${chalk.yellow(`Type "wipe" to confirm wiping ${scope} commands: `)}`)
  ).trim();
  return answer === "wipe";
}

async function runTUI() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    printMenu();
    const choice = (await prompt(rl, `  ${chalk.cyan("Select an option:")} `)).trim();
    console.log();
    switch (choice) {
      case "1":
        await globalUpdate();
        break;
      case "2":
        if (await confirmWipe(rl, "global")) await globalWipe();
        else log.info("Wipe cancelled.");
        break;
      case "3":
        await guildUpdate();
        break;
      case "4":
        if (await confirmWipe(rl, "all guild")) await guildWipe();
        else log.info("Wipe cancelled.");
        break;
      case "5":
        await listGuilds();
        break;
      case "6":
        await leaveGuild(rl);
        break;
      case "7":
        rl.close();
        process.exit(0);
        break;
      default:
        log.err("Invalid selection.");
    }
    await prompt(rl, `\n  ${chalk.dim("Press Enter to continue...")}`);
  }
}

if (process.argv[2]) {
  switch (process.argv[2]) {
    case "global":
      if (process.argv[3] === "wipe") await globalWipe();
      else if (process.argv[3] === "update") await globalUpdate();
      break;
    case "guild":
      if (process.argv[3] === "wipe") await guildWipe();
      else if (process.argv[3] === "update") await guildUpdate();
      else if (process.argv[3] === "list") await listGuilds();
      else if (process.argv[3] === "leave" && process.argv[4]) {
        try {
          await rest.delete(Routes.userGuild(process.argv[4]));
          console.log(`Left guild ${process.argv[4]}`);
        } catch (error) {
          console.error(error);
        }
      }
      break;
    default:
      console.log("Invalid selection");
  }
  process.exit(0);
} else {
  await runTUI();
}
