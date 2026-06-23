/**
 * Bot Sync Manager
 * Materializes core + selected features into a per-bot git repo.
 * Usage (CLI):  node bin/sync-bot.mjs <name|all> [--commit] [--push] [--build] [--push-image]
 * Usage (TUI):  node bin/sync-bot.mjs
 */
import chalk from "chalk";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants / setup
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const catalog = JSON.parse(readFileSync(join(ROOT, "apps.json"), "utf8"));
const platformPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// Feature-sets ("groups") are pure aliases for a bundle of features; a set name
// must not collide with an app name, or expansion would be ambiguous.
for (const setName of Object.keys(catalog.sets ?? {})) {
  if (catalog.apps[setName]) {
    throw new Error(`feature-set "${setName}" collides with an app of the same name`);
  }
}

// Capabilities and apps share the `requires` namespace, so their names must be
// distinct (and must not collide with a set name) for closure resolution to be
// unambiguous.
for (const capName of Object.keys(catalog.capabilities ?? {})) {
  if (catalog.apps[capName]) {
    throw new Error(`capability "${capName}" collides with an app of the same name`);
  }
  if (catalog.sets?.[capName]) {
    throw new Error(`capability "${capName}" collides with a feature-set of the same name`);
  }
}

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
 * Expands any feature-set names in `selected` into their member features.
 * Sets (declared in apps.json `sets`) are pure aliases; members may be
 * features, apps, or other sets. `path` tracks the current expansion chain to
 * catch cycles while still allowing diamonds (a set referenced via two branches).
 */
function expandSets(selected, path = new Set()) {
  const sets = catalog.sets ?? {};
  const out = [];
  for (const name of selected) {
    if (!sets[name]) {
      out.push(name);
      continue;
    }
    if (path.has(name)) throw new Error(`feature-set cycle through "${name}"`);
    out.push(...expandSets(sets[name], new Set([...path, name])));
  }
  return out;
}

/**
 * Build the dependency graph over capabilities, apps, and features.
 * Apps and capabilities share one `requires` namespace. A feature is keyed by
 * its canonical "<app>/<feature>" name and implicitly requires its app, so
 * selecting a feature always pulls in its app (and the app's requires).
 */
function buildDepGraph() {
  const graph = {};
  for (const [name, def] of Object.entries(catalog.capabilities ?? {})) {
    graph[name] = { kind: "capability", requires: def.requires ?? [] };
  }
  for (const [name, def] of Object.entries(catalog.apps)) {
    graph[name] = { kind: "app", requires: def.requires ?? [] };
    for (const [feat, featDef] of Object.entries(def.features ?? {})) {
      graph[`${name}/${feat}`] = {
        kind: "feature",
        parent: name,
        requires: [name, ...(featDef.requires ?? [])],
      };
    }
  }
  return graph;
}

const depGraph = buildDepGraph();

/**
 * Expand a selected list into resolvable graph-node names. Feature-set aliases
 * ("groups") expand to their members; every other name passes through as-is.
 * Features are opt-in: a bare app name resolves to the app SHELL ONLY (its
 * ladder/settings, no features) — features must be listed individually
 * ("department/logs") or pulled via a set. A "<app>/<feature>" name keeps its
 * form (its app is pulled through the dependency graph).
 */
function expandSelection(selected) {
  return expandSets(selected);
}

/**
 * BFS over the dependency graph to return the full transitive closure of a
 * selected set, partitioned into sorted `capabilities`, `apps`, and `features`
 * (canonical "<app>/<feature>" names). Throws on unknown names.
 */
function resolveClosure(selected) {
  const visited = new Set();
  const queue = expandSelection(selected);

  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    if (!depGraph[name]) {
      throw new Error(`unknown app, feature, or capability "${name}"`);
    }
    visited.add(name);
    for (const dep of depGraph[name].requires) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }

  const byKind = kind => [...visited].filter(n => depGraph[n].kind === kind).sort();
  return {
    capabilities: byKind("capability"),
    apps: byKind("app"),
    features: byKind("feature"),
  };
}

export { resolveClosure };

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
// generate(bot) - materialize core + features into the bot repo
// ---------------------------------------------------------------------------

/**
 * Generates the bot repo for `bot`.
 * Returns { dest, features } on success, or null if the destination is missing.
 */
function generate(bot) {
  const { apps, capabilities, features } = resolveClosure(bot.features);

  // Selected features grouped by app, for the selective copy below.
  const selectedFeatsByApp = {};
  for (const full of features) {
    const [app, feat] = full.split("/");
    (selectedFeatsByApp[app] ??= []).push(feat);
  }

  // Verify every app/feature/capability directory exists before touching anything.
  for (const a of apps) {
    if (!existsSync(join(ROOT, "src", "apps", a))) {
      throw new Error(`app directory not found: src/apps/${a}`);
    }
  }
  for (const full of features) {
    if (!existsSync(join(ROOT, "src", "apps", ...full.split("/")))) {
      throw new Error(`feature directory not found: src/apps/${full}`);
    }
  }
  for (const c of capabilities) {
    if (!existsSync(join(ROOT, "src", "core", "capabilities", c))) {
      throw new Error(`capability directory not found: src/core/capabilities/${c}`);
    }
  }

  const dest = resolve(ROOT, bot.dest);

  // The destination repo must already be cloned - we don't create it.
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
  // COPY: kernel source (everything in src/core EXCEPT the capability tier),
  // then only the entitled capabilities, entitled apps/features, and config files.
  // ------------------------------------------------------------------
  const capabilitiesDir = join(ROOT, "src", "core", "capabilities");
  cpSync(join(ROOT, "src", "core"), join(dest, "src", "core"), {
    recursive: true,
    filter: src => src !== capabilitiesDir && !src.startsWith(capabilitiesDir + sep),
  });

  for (const c of capabilities) {
    cpSync(join(capabilitiesDir, c), join(dest, "src", "core", "capabilities", c), {
      recursive: true,
    });
  }

  for (const a of apps) {
    const appSrc = join(ROOT, "src", "apps", a);
    const appDest = join(dest, "src", "apps", a);
    const declaredFeats = Object.keys(catalog.apps[a].features ?? {});

    // Copy the app shell (index.js, lib/, and any non-feature lib dirs like
    // ingame — which ship with the app even when nothing entitled uses them)
    // plus only the selected feature subdirs; unselected features are excluded.
    const selected = selectedFeatsByApp[a] ?? [];
    const excluded = declaredFeats.filter(f => !selected.includes(f)).map(f => join(appSrc, f));
    cpSync(appSrc, appDest, {
      recursive: true,
      filter: src => !excluded.some(ex => src === ex || src.startsWith(ex + sep)),
    });
  }

  for (const f of STANDARD_FILES) {
    const src = join(ROOT, f);
    if (existsSync(src)) cpSync(src, join(dest, f));
  }

  // ------------------------------------------------------------------
  // WRITE package.json
  // ------------------------------------------------------------------

  // Dependency assembly. Capabilities, apps, and features may each declare their
  // own dependencies in a package.json; those are "module-owned". The kernel dep
  // set is the platform's deps MINUS every module-owned dep, so a dep like
  // mongoose (owned by the db capability) ships only to bots that entitle it.
  const readDeps = pkgPath =>
    existsSync(pkgPath) ? (JSON.parse(readFileSync(pkgPath, "utf8")).dependencies ?? {}) : {};

  const capabilityDeps = Object.fromEntries(
    Object.keys(catalog.capabilities ?? {}).map(c => [
      c,
      readDeps(join(ROOT, "src", "core", "capabilities", c, "package.json")),
    ]),
  );
  const appDeps = Object.fromEntries(
    Object.keys(catalog.apps).map(a => [a, readDeps(join(ROOT, "src", "apps", a, "package.json"))]),
  );
  const featureDeps = {};
  for (const [name, def] of Object.entries(catalog.apps)) {
    for (const feat of Object.keys(def.features ?? {})) {
      featureDeps[`${name}/${feat}`] = readDeps(
        join(ROOT, "src", "apps", name, feat, "package.json"),
      );
    }
  }

  const moduleOwnedDepNames = new Set(
    [
      ...Object.values(capabilityDeps),
      ...Object.values(appDeps),
      ...Object.values(featureDeps),
    ].flatMap(d => Object.keys(d)),
  );

  // Kernel deps: platform deps not claimed by any capability/app/feature.
  const mergedDeps = Object.fromEntries(
    Object.entries(platformPkg.dependencies).filter(([name]) => !moduleOwnedDepNames.has(name)),
  );
  // Layer in deps for the entitled capabilities, apps, and features.
  for (const c of capabilities) Object.assign(mergedDeps, capabilityDeps[c]);
  for (const a of apps) Object.assign(mergedDeps, appDeps[a]);
  for (const f of features) Object.assign(mergedDeps, featureDeps[f]);

  const sortedDeps = Object.fromEntries(
    Object.entries(mergedDeps).sort(([a], [b]) => a.localeCompare(b)),
  );

  const botPkg = {
    name: bot.name,
    version: "0.0.0",
    description: `${bot.name} Discord bot - generated from the discord-bot-platform monorepo. Do not edit by hand.`,
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
    // the same patched transitive versions as the platform - otherwise the image
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

> **Generated repository - do not edit by hand.**
> Source of truth: the \`discord-bot-platform\` monorepo. Regenerate with \`npm run sync -- ${bot.name}\`.
> Synced from platform commit \`${sha}\`.

Entitled apps: ${apps.join(", ")}
Entitled features: ${features.join(", ") || "none"}
Entitled capabilities: ${capabilities.join(", ") || "none"}

## Run

1. Create \`.env\` with \`BOT_TOKEN\`, \`CLIENT_ID\`${capabilities.includes("db") ? ", `MONGO`" : ""}, plus any feature env (e.g. \`GAME_NAME\`/\`GAME_ID\`, \`AUTO_LOG_API_URL\`).
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

  log.ok(
    `${bot.name} → ${dest}  (caps: ${capabilities.join(", ") || "none"}; apps: ${apps.join(", ")}${features.length ? `; features: ${features.join(", ")}` : ""})`,
  );
  return { dest, apps, capabilities, features };
}

// ---------------------------------------------------------------------------
// commitAndPush(bot, dest, {push})
// ---------------------------------------------------------------------------

/**
 * Stages all changes, commits with a platform-sha message, and optionally
 * pushes. Each git step is wrapped in try/catch so a failure is reported
 * without crashing the process.
 *
 * If the bot repo's last commit already records this platform SHA (i.e. it was
 * already synced from this exact platform commit), the git steps are skipped
 * entirely - the caller still proceeds to any image build/push.
 */
function commitAndPush(bot, dest, { push }) {
  const sha = platformSha();

  // Skip when the repo is already at this platform commit: the would-be commit
  // message (`...platform <sha>`) is already the last commit's. Do nothing here
  // and let the caller continue (e.g. to push the image).
  if (sha !== "unknown") {
    try {
      const lastMsg = execFileSync("git", ["-C", dest, "log", "-1", "--format=%s"], {
        stdio: ["pipe", "pipe", "pipe"],
      }).toString();
      if (lastMsg.includes(sha)) {
        log.info(`already synced from platform ${sha}; skipping commit`);
        return;
      }
    } catch {
      // No commits yet, or not a git repo - fall through to a normal commit.
    }
  }

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
// buildImage(bot, dest, {push})
// ---------------------------------------------------------------------------

/**
 * Builds the bot's Docker image from its generated repo (`dest` is the build
 * context; the Dockerfile written by generate() lives there) and optionally
 * pushes it. Tags both `<image>:latest` and `<image>:<platform-sha>` - the SHA
 * tag is an immutable provenance pin matching the Dockerfile's
 * `org.opencontainers.image.revision` label. Each docker step is wrapped in
 * try/catch so a failure is reported without crashing the process. Does not run
 * `docker login`; an auth failure on push is surfaced like any other error.
 */
function buildImage(bot, dest, { push }) {
  const sha = platformSha();
  const tags = [`${bot.image}:latest`];
  if (sha !== "unknown") tags.push(`${bot.image}:${sha}`);

  // Build once, applying every tag.
  const buildArgs = ["build"];
  for (const t of tags) buildArgs.push("-t", t);
  buildArgs.push(dest);

  try {
    execFileSync("docker", buildArgs, { stdio: "inherit" });
    log.ok(`built ${tags.join(", ")}`);
  } catch (err) {
    log.err(`docker build failed: ${err.message}`);
    return;
  }

  if (!push) return;

  // Push each tag independently so one failure doesn't hide the other.
  for (const t of tags) {
    try {
      execFileSync("docker", ["push", t], { stdio: "inherit" });
      log.ok(`pushed ${t}`);
    } catch (err) {
      log.err(`docker push failed for ${t}: ${err.message}`);
    }
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
      count = resolveClosure(b.features).features.length;
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

    // Ask the git action. Generate always runs; this only governs commit/push.
    console.log();
    console.log(`  ${chalk.bold("Git action")}`);
    console.log(`  ${chalk.bold("1.")} None`);
    console.log(`  ${chalk.bold("2.")} Commit`);
    console.log(`  ${chalk.bold("3.")} Commit + push`);
    console.log();
    const gitAction = (await prompt(rl, `  ${chalk.cyan("Select a git action:")} `)).trim();
    console.log();

    if (!["1", "2", "3"].includes(gitAction)) {
      log.err("Invalid git action.");
      await prompt(rl, `\n  ${chalk.dim("Press Enter to continue...")}`);
      continue;
    }

    // Ask the docker action (independent of the git action).
    console.log(`  ${chalk.bold("Docker action")}`);
    console.log(`  ${chalk.bold("1.")} None`);
    console.log(`  ${chalk.bold("2.")} Build image`);
    console.log(`  ${chalk.bold("3.")} Build + push`);
    console.log();
    const dockerAction = (await prompt(rl, `  ${chalk.cyan("Select a docker action:")} `)).trim();
    console.log();

    if (!["1", "2", "3"].includes(dockerAction)) {
      log.err("Invalid docker action.");
      await prompt(rl, `\n  ${chalk.dim("Press Enter to continue...")}`);
      continue;
    }

    const doCommit = gitAction === "2" || gitAction === "3";
    const doPush = gitAction === "3";
    const doBuild = dockerAction === "2" || dockerAction === "3";
    const doPushImage = dockerAction === "3";

    for (const bot of targets) {
      try {
        const result = generate(bot);
        if (!result) continue;
        if (doCommit) commitAndPush(bot, result.dest, { push: doPush });
        if (doBuild) buildImage(bot, result.dest, { push: doPushImage });
      } catch (err) {
        log.err(`${bot.name}: ${err.message}`);
      }
    }

    await prompt(rl, `\n  ${chalk.dim("Press Enter to continue...")}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point - CLI mode if args present, TUI otherwise. Guarded so the module
// can be imported (e.g. by tests) without running the CLI/TUI.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain && process.argv[2]) {
  // Usage: node bin/sync-bot.mjs <name|all> [--commit] [--push] [--build] [--push-image]
  const [, , target, ...flags] = process.argv;
  const doCommit = flags.includes("--commit") || flags.includes("--push");
  const doPush = flags.includes("--push"); // --push implies --commit
  const doBuild = flags.includes("--build") || flags.includes("--push-image");
  const doPushImage = flags.includes("--push-image"); // --push-image implies --build

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
      if (!result) continue;
      if (doCommit) commitAndPush(bot, result.dest, { push: doPush });
      if (doBuild) buildImage(bot, result.dest, { push: doPushImage });
    } catch (err) {
      log.err(`${bot.name}: ${err.message}`);
    }
  }

  process.exit(0);
} else if (isMain) {
  await runTUI();
}
