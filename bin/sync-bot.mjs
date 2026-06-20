/**
 * Bot Sync Manager
 * Materializes core + selected features into a per-bot git repo.
 * Usage (CLI):  node bin/sync-bot.mjs <name|all> [--commit] [--push]
 * Usage (TUI):  node bin/sync-bot.mjs
 */
import chalk from "chalk";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants / setup
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const catalog = JSON.parse(readFileSync(join(ROOT, "features.json"), "utf8"));
const platformPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** Load all bot manifests from bots/*.json */
const bots = readdirSync(join(ROOT, "bots"))
  .filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(readFileSync(join(ROOT, "bots", f), "utf8")));

const log = {
  info: msg => console.log(`  ${chalk.cyan("info")}  ${msg}`),
  ok: msg => console.log(`  ${chalk.green("ok")}    ${msg}`),
  warn: msg => console.log(`  ${chalk.yellow("warn")}  ${msg}`),
  err: msg => console.log(`  ${chalk.red("err")}   ${msg}`),
};

/** Files copied verbatim from platform root → bot repo root (no generation). */
const STANDARD_FILES = [
  "eslint.config.mjs",
  ".prettierrc.json",
  ".prettierignore",
  ".editorconfig",
  ".gitattributes",
  ".node-version",
];

/** All root-level files in the bot repo that are generated/managed by this script. */
const GENERATED_ROOT_FILES = [
  ...STANDARD_FILES,
  "package.json",
  "package-lock.json",
  "Dockerfile",
  ".dockerignore",
  ".gitignore",
  "README.md",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * BFS over feature `requires` to return the full transitive closure of a
 * selected feature set, as a sorted array of feature names.
 * Throws if any referenced feature name is not in the catalog.
 */
function resolveClosure(selected) {
  const known = catalog.features;
  const visited = new Set();
  const queue = [...selected];

  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    if (!known[name]) throw new Error(`unknown feature "${name}"`);
    visited.add(name);
    for (const dep of known[name].requires ?? []) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }

  return [...visited].sort();
}

/**
 * Returns the short HEAD commit SHA of the platform repo, or "unknown" on
 * any failure (e.g. no git history in CI).
 */
function platformSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
  } catch {
    return "unknown";
  }
}

/**
 * Converts a container image reference to the corresponding GitHub repo URL.
 * e.g. "ghcr.io/ridgeway-automation/department-bot"
 *   → "https://github.com/ridgeway-automation/department-bot"
 */
function sourceUrl(image) {
  return "https://github.com/" + image.replace(/^ghcr\.io\//, "");
}

// ---------------------------------------------------------------------------
// generate(bot) — materialize core + features into the bot repo
// ---------------------------------------------------------------------------

/**
 * Generates the bot repo for `bot`.
 * Returns { dest, features } on success, or null if the destination is missing.
 */
function generate(bot) {
  const features = resolveClosure(bot.features);

  // Verify every feature directory exists in the platform before touching anything.
  for (const f of features) {
    const featureSrc = join(ROOT, "src", "features", f);
    if (!existsSync(featureSrc)) {
      throw new Error(`feature directory not found: ${featureSrc}`);
    }
  }

  const dest = resolve(ROOT, bot.dest);

  // The destination repo must already be cloned — we don't create it.
  if (!existsSync(dest)) {
    log.err(`bot repo must be cloned to ${dest} first`);
    return null;
  }

  if (!existsSync(join(dest, ".git"))) {
    log.warn(`${dest} is not a git repo — continuing anyway`);
  }

  // ------------------------------------------------------------------
  // CLEAN: remove previously generated artifacts so stale files from
  // removed feature entitlements don't linger.
  // ------------------------------------------------------------------
  rmSync(join(dest, "src"), { recursive: true, force: true });
  for (const f of GENERATED_ROOT_FILES) {
    rmSync(join(dest, f), { force: true });
  }

  // ------------------------------------------------------------------
  // COPY: core source, entitled features, and standard config files.
  // ------------------------------------------------------------------
  cpSync(join(ROOT, "src", "core"), join(dest, "src", "core"), { recursive: true });

  for (const f of features) {
    cpSync(join(ROOT, "src", "features", f), join(dest, "src", "features", f), { recursive: true });
  }

  for (const f of STANDARD_FILES) {
    const src = join(ROOT, f);
    if (existsSync(src)) cpSync(src, join(dest, f));
  }

  // ------------------------------------------------------------------
  // WRITE package.json
  // ------------------------------------------------------------------

  // Merge platform deps with any feature-specific deps, then sort keys.
  const mergedDeps = { ...platformPkg.dependencies };
  for (const f of features) {
    const featurePkgPath = join(ROOT, "src", "features", f, "package.json");
    if (existsSync(featurePkgPath)) {
      const featurePkg = JSON.parse(readFileSync(featurePkgPath, "utf8"));
      Object.assign(mergedDeps, featurePkg.dependencies ?? {});
    }
  }
  const sortedDeps = Object.fromEntries(
    Object.entries(mergedDeps).sort(([a], [b]) => a.localeCompare(b)),
  );

  const botPkg = {
    name: bot.name,
    version: "0.0.0",
    description: `${bot.name} Discord bot — generated from the discord-bot-platform monorepo. Do not edit by hand.`,
    main: "src/core/bot.js",
    type: "module",
    private: true,
    author: platformPkg.author,
    license: platformPkg.license,
    scripts: {
      bot: "node --env-file=.env src/core/bot.js",
      "deploy-commands": "node --env-file=.env src/core/deploy-commands.js",
      lint: platformPkg.scripts.lint,
      "lint:fix": platformPkg.scripts["lint:fix"],
      format: platformPkg.scripts.format,
      "format:check": platformPkg.scripts["format:check"],
    },
    imports: platformPkg.imports,
    dependencies: sortedDeps,
    devDependencies: platformPkg.devDependencies,
    // Carry dependency overrides (security pins) so the bot's `npm ci` resolves
    // the same patched transitive versions as the platform — otherwise the image
    // would rebuild vulnerable transitive deps (e.g. undici).
    ...(platformPkg.overrides ? { overrides: platformPkg.overrides } : {}),
  };

  writeFileSync(join(dest, "package.json"), JSON.stringify(botPkg, null, 2) + "\n");

  // ------------------------------------------------------------------
  // WRITE Dockerfile
  // ------------------------------------------------------------------
  const sha = platformSha();

  writeFileSync(
    join(dest, "Dockerfile"),
    `FROM node:24-alpine

LABEL org.opencontainers.image.source=${sourceUrl(bot.image)}
LABEL org.opencontainers.image.revision=${sha}

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node

CMD ["node", "src/core/bot.js"]
`,
  );

  // ------------------------------------------------------------------
  // WRITE .gitignore
  // ------------------------------------------------------------------
  writeFileSync(
    join(dest, ".gitignore"),
    `node_modules
.env
.env.*
`,
  );

  // ------------------------------------------------------------------
  // WRITE .dockerignore
  // ------------------------------------------------------------------
  writeFileSync(
    join(dest, ".dockerignore"),
    `.git
**/.git
node_modules
**/node_modules
.env
.env.*
.claude
README.md
`,
  );

  // ------------------------------------------------------------------
  // WRITE README.md
  // ------------------------------------------------------------------
  writeFileSync(
    join(dest, "README.md"),
    `# ${bot.name} bot

> **Generated repository — do not edit by hand.**
> Source of truth: the \`discord-bot-platform\` monorepo. Regenerate with \`npm run sync -- ${bot.name}\`.
> Synced from platform commit \`${sha}\`.

Entitled features: ${features.join(", ")}

## Run

1. Create \`.env\` with \`BOT_TOKEN\`, \`CLIENT_ID\`, \`MONGO\`, plus any feature env (e.g. \`GAME_NAME\`/\`GAME_ID\`, \`AUTO_LOG_API_URL\`).
2. \`npm ci && npm run bot\`, or build the image: \`docker build -t ${bot.image}:latest .\`
3. Register slash commands once: \`npm run deploy-commands -- global update\`.
`,
  );

  // ------------------------------------------------------------------
  // Regenerate lockfile so the bot repo stays installable without
  // needing access to the platform monorepo.
  // ------------------------------------------------------------------
  try {
    execFileSync("npm", ["install", "--package-lock-only"], { cwd: dest, stdio: "inherit" });
  } catch {
    log.warn("couldn't regenerate lockfile; run npm install in the bot repo");
  }

  log.ok(`${bot.name} → ${dest}  (${features.length} features: ${features.join(", ")})`);
  return { dest, features };
}

// ---------------------------------------------------------------------------
// commitAndPush(bot, dest, {push})
// ---------------------------------------------------------------------------

/**
 * Stages all changes, commits with a platform-sha message, and optionally
 * pushes. Each git step is wrapped in try/catch so a failure is reported
 * without crashing the process.
 */
function commitAndPush(bot, dest, { push }) {
  const sha = platformSha();

  // Stage everything.
  try {
    execFileSync("git", ["-C", dest, "add", "-A"]);
  } catch (err) {
    log.err(`git add failed: ${err.message}`);
    return;
  }

  // Commit.
  try {
    execFileSync("git", ["-C", dest, "commit", "-m", `chore: sync from platform ${sha}`], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
    if (output.includes("nothing to commit")) {
      log.info("nothing to commit");
      return;
    }
    log.err(`git commit failed: ${err.message}`);
    return;
  }

  if (!push) return;

  // Push.
  try {
    execFileSync("git", ["-C", dest, "push"], { stdio: "inherit" });
    log.ok("pushed");
  } catch (err) {
    log.err(`git push failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// TUI helpers
// ---------------------------------------------------------------------------

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function printMenu(botList) {
  console.clear();
  console.log(chalk.cyan.bold("╔══════════════════════════════════╗"));
  console.log(chalk.cyan.bold("║        Bot Sync Manager          ║"));
  console.log(chalk.cyan.bold("╚══════════════════════════════════╝"));
  console.log();
  for (let i = 0; i < botList.length; i++) {
    const b = botList[i];
    // Show the resolved feature count (closure, not just the manifest list).
    let count;
    try {
      count = resolveClosure(b.features).length;
    } catch {
      count = "?";
    }
    console.log(`  ${chalk.bold(`${i + 1}.`)} ${b.name}  ${chalk.dim(`(${count} features)`)}`);
  }
  console.log();
  console.log(`  ${chalk.bold("a.")} All bots`);
  console.log(`  ${chalk.bold("q.")} Quit`);
  console.log();
}

async function runTUI() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  while (true) {
    printMenu(bots);
    const choice = (await prompt(rl, `  ${chalk.cyan("Select a bot:")} `)).trim().toLowerCase();
    console.log();

    // Resolve which bots were selected.
    let targets;
    if (choice === "q") {
      rl.close();
      process.exit(0);
    } else if (choice === "a") {
      targets = bots;
    } else {
      const idx = parseInt(choice, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= bots.length) {
        log.err("Invalid selection.");
        await prompt(rl, `\n  ${chalk.dim("Press Enter to continue...")}`);
        continue;
      }
      targets = [bots[idx]];
    }

    // Ask what action to take.
    console.log();
    console.log(`  ${chalk.bold("1.")} Generate only`);
    console.log(`  ${chalk.bold("2.")} Generate + commit`);
    console.log(`  ${chalk.bold("3.")} Generate + commit + push`);
    console.log();
    const action = (await prompt(rl, `  ${chalk.cyan("Select an action:")} `)).trim();
    console.log();

    if (!["1", "2", "3"].includes(action)) {
      log.err("Invalid action.");
      await prompt(rl, `\n  ${chalk.dim("Press Enter to continue...")}`);
      continue;
    }

    const doCommit = action === "2" || action === "3";
    const doPush = action === "3";

    for (const bot of targets) {
      try {
        const result = generate(bot);
        if (result && doCommit) {
          commitAndPush(bot, result.dest, { push: doPush });
        }
      } catch (err) {
        log.err(`${bot.name}: ${err.message}`);
      }
    }

    await prompt(rl, `\n  ${chalk.dim("Press Enter to continue...")}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point — CLI mode if args present, TUI otherwise
// ---------------------------------------------------------------------------

if (process.argv[2]) {
  // Usage: node bin/sync-bot.mjs <name|all> [--commit] [--push]
  const [, , target, ...flags] = process.argv;
  const doCommit = flags.includes("--commit") || flags.includes("--push");
  const doPush = flags.includes("--push"); // --push implies --commit

  let targets;
  if (target === "all") {
    targets = bots;
  } else {
    const found = bots.find(b => b.name === target);
    if (!found) {
      log.err(`Unknown bot "${target}". Available: ${bots.map(b => b.name).join(", ")}`);
      process.exit(1);
    }
    targets = [found];
  }

  for (const bot of targets) {
    try {
      const result = generate(bot);
      if (result && doCommit) {
        commitAndPush(bot, result.dest, { push: doPush });
      }
    } catch (err) {
      log.err(`${bot.name}: ${err.message}`);
    }
  }

  process.exit(0);
} else {
  await runTUI();
}
