# discord-bot-platform

A monorepo for a family of Discord department-management bots. This is the single source of truth for all bot logic: `src/core/` provides a portable base framework, and `src/features/` contains every feature that bots can opt into. Per-bot repositories (e.g., ridgeway-automation, harrison-automation) are *generated* from this monorepo by `bin/sync-bot.mjs` and must never be hand-edited—all changes flow back here, then re-sync into generated repos.

## Layout

```
.
├── src/
│   ├── core/               # Base bot framework (events, commands, db, modules)
│   └── features/           # Opt-in features (each has index.js manifest)
│       ├── action/         # Department action requests
│       ├── autolog/        # Auto-logging (Roblox team tracking)
│       ├── ingame/         # In-game data layer (shared by autolog, watchlist)
│       ├── loa/            # Leave of Absence
│       ├── logs/           # Activity log system
│       ├── pager/          # Member pager
│       └── watchlist/      # In-game member watchlist
├── bots/                   # Per-bot manifests
│   ├── ridgeway.json       # Ridgeway bot config
│   └── harrison.json       # Harrison bot config
├── features.json           # Feature catalog (with `requires` deps)
├── bin/
│   └── sync-bot.mjs        # Generator: materialize core + features → per-bot repo
└── package.json            # npm scripts, imports
```

## Commands

```bash
npm run bot                           # Start the bot (loads .env)
npm run deploy-commands              # Deploy slash commands (interactive TUI)
npm run sync [name|all] [--commit] [--push]  # Generate/sync bot repos
npm run lint                         # oxlint + eslint
npm run lint:fix                     # Auto-fix lint issues
npm run format                       # Prettier write
```

Note: `npm run bot`, `npm run deploy-commands`, and linting run with *all* features loaded at once.

## Adding a Feature

1. Create a `src/features/<name>/` directory.
2. Add an `index.js` with a feature manifest:
   ```js
   export default {
     name: 'myfeature',
     commands: [...],      // (optional)
     events: [...],        // (optional)
     schedules: [...],     // (optional)
     settings: {...},      // (optional) Mongoose schema fragment
     migrate: async () => {} // (optional) one-time setup at startup
   };
   ```
3. Add an entry to `features.json`:
   ```json
   {
     "requires": ["dependency1", "dependency2"]
   }
   ```
4. List the feature in the `features` array of each `bots/<name>.json` that should include it.

## Adding a Bot

1. Clone the bot's empty repository as a sibling (e.g., `../my-automation/department-bot`).
2. Create `bots/<name>.json` with the bot's config:
   ```json
   {
     "name": "mybot",
     "dest": "../my-automation/department-bot",
     "image": "ghcr.io/my-automation/department-bot",
     "features": ["loa", "logs", "pager", "action", "autolog", "watchlist"]
   }
   ```
3. Run `npm run sync -- <name>` to generate the bot repo.

## Generating / Syncing a Bot

```bash
npm run sync [name|all] [--commit] [--push]
```

Without arguments, opens an interactive menu.

**What it does:**
- Materializes `src/core/` and the bot's entitled features into the bot's destination repo.
- Generates a `Dockerfile` and deployment configuration.
- Creates a runnable, readable subset of the monorepo (not all features).
- Optionally commits and pushes to the bot's remote.

**Important:** Generated bot repos are build artifacts. Edit features here, then re-sync to push changes into generated repos.
