# Capability tier & nested subfeatures

Status: **in progress** — Phase 1 (kernel seams) ✅ · Phase 2 (extract capabilities) ✅ · Phase 3 (sync rewrite) ✅ · Phase 4 (nested subfeatures) ✅ · Phase 5a (department restructure) ✅ · **Phase 6 (apps/features reframe) — PLANNED, implement next** · Phase 5b (residency + flu) after Phase 6.

> Phase 5a complete: loa/logs/pager/action are subfeatures of a `department`
> parent that installs the ladder (so the `permissions` capability is fully
> policy-free) and owns `roles` + `action_log_channel` + their `/config` fragments.
> The settings base schema is now just `guild_id` + `color`. The Phase 2/3
> transitional notes are resolved. The permission ladder is now a partial-order
> DAG (IA and Command are separate tracks; see `createLadder`).
>
> NOTE: the sections below this plan use the older "feature/subfeature" vocabulary
> for the same mechanism that Phase 6 renames to "app/feature". Phase 6 is the
> authoritative next step.

## Phase 6 — capabilities / apps / features (PLAN — implement this next)

Decision (2026-06-21): reframe the top tier as **apps**. Three tiers:

- **capabilities** (`src/core/capabilities/`): `db`, `settings`, `permissions` — platform plumbing.
- **apps** (`src/apps/<app>/`): `department`, `residency`, `flu` — deployable products. An app's `index.js` is the parent manifest (installs its ladder via `createLadder`, owns app-wide settings/config). Shared code in app `lib/` dirs (no `index.js` ⇒ not a feature).
- **features** (`src/apps/<app>/<feature>/`): units within an app (`loa`, `logs`, `autolog`, `badge-walk`, …), each individually selectable. Canonical name `"<app>/<feature>"`.

**Selection model** (per user): a bot does NOT inherently get all of an app's
features. Features are opt-in — listed individually (`"department/logs"`) or
bundled via **groups** (sets). No core/optional flag — "core" is just a group you
choose. So bare `"department"` resolves to the **app shell only** (ladder +
settings, no features); features are pulled explicitly or via sets (each feature
pulls its app parent through the dependency graph). A feature-less app (flu) is
just `["flu"]`.

This is the existing subfeature engine **reframed**, and it SIMPLIFIES it: remove
the Phase 4 bare-parent → all-subfeatures auto-expansion. One-level loader
recursion, closure (feature implicitly requires its app), selective copy, and the
kernel/module dep split are all unchanged.

### Steps (from current Phase 5a state)

1. **Move tier.** `git mv src/features src/apps`. Move the loose ingame dirs under
   department: `src/apps/{ingame,autolog,watchlist}` → `src/apps/department/{ingame,autolog,watchlist}`
   (department already holds loa/logs/pager/action). `ingame/` stays a lib (no `index.js`) inside department.
2. **Alias.** `package.json` imports `#features/*` → `#apps/*`; update every `#features/...` import.
   Cross-imports become: autolog → `#apps/department/logs/module`; ingame lookups → `#apps/department/ingame/...`
   (or relative `../ingame/...`).
3. **Catalog.** Rename `features.json` → `apps.json`:
   ```jsonc
   {
     "capabilities": { "db": {"requires":[]}, "settings": {"requires":["db"]}, "permissions": {"requires":[]} },
     "apps": {
       "department": { "requires": ["permissions","settings"],
         "features": { "loa": {}, "logs": {}, "pager": {}, "action": {},
                       "autolog": { "requires": ["department/logs"] }, "watchlist": {} } },
       "residency": { "requires": ["permissions","db"], "features": { "badge-walk": {}, "user-info": {} } },
       "flu": { "requires": ["permissions"] }
     },
     "sets": {
       "department-core": ["department/loa","department/logs","department/pager","department/action"],
       "ingame-suite":    ["department/autolog","department/watchlist"]
     }
   }
   ```
   `ingame` is a lib (ships with the app), NOT a feature — autolog/watchlist depend on it by import, not `requires`.
4. **sync (`bin/sync-bot.mjs`).** catalog path `features.json`→`apps.json`, `src/features`→`src/apps`.
   `buildDepGraph`: `catalog.features`→`catalog.apps`, nested `subfeatures`→`features`; partition closure as
   `{capabilities, apps, features}`. **`expandSelection`: remove bare-parent → all-features expansion** (sets still
   expand). Copy/deps/verify: same logic, `src/apps` paths + nested `features` key. Collision guards: app vs
   capability vs set names.
5. **loader (`#modules/Features`).** `featuresPath` → `appsPath` (`src/apps`). Keep `loadFeatures()` /
   `client.features` names (flat manifest list of apps + features); recursion unchanged (one level: app → features).
6. **bots.** harrison `["department-core"]`; ridgeway `["department-core","ingame-suite"]`.
7. **docs.** Refresh CLAUDE.md to the capabilities/apps/features vocabulary (the broader refresh it already needs).

### Verify
- lint; `npm run sync -- all` → harrison (department + loa/logs/pager/action), ridgeway (+ autolog/watchlist + ingame lib).
- generated `src/apps/department/{loa,logs,pager,action,autolog,watchlist,ingame,lib}`; all aliases/cross-imports resolve.
- a `["department-core"]`-only bot **excludes** autolog/watchlist (selective copy); ingame lib ships with the app (dead if unused — acceptable; note it).
- runtime manifest-load + ladder + settings-model checks (as in prior phases).

### Then Phase 5b (residency + flu) on the apps model
- `src/apps/residency/` app (apply flow in parent + `lib/` Roblox API) + `badge-walk`/`user-info` features; linear ladder; `request` schema; requires `[permissions, db]`. `bots/residency.json`.
- `src/apps/flu/` feature-less app; 2-level ladder; no db/settings. `bots/flu.json`.

> Phase 2 note: the `permissions` capability is **transitionally** still installing
> the department ladder (with `DEPARTMENT_LEVELS` in `permissions/index.js`) so the
> existing department bots keep working. It becomes fully policy-free in Phase 5,
> when the `department` feature takes over the install. `roles` + `action_log_channel`
> likewise still live in the settings base schema until Phase 5.

This document describes a planned restructuring of the platform into three tiers
(**kernel → capabilities → features**) plus **nested subfeatures**, so that
lightweight bots that previously copy-pasted the core can run on the shared
framework. The two driving cases are:

- `../harrison-automation/residency-bot` — a Roblox residency-application bot:
  an apply flow + a shared Roblox API layer + semi-independent `/residency`,
  `/badge_walk`, `/user_info` commands. Uses **static config**, its **own**
  permission ladder, and the DB only for a `request` schema.
- `../ridgeway-automation/rsp-flu-bot` — an AFL (firearm-license) bot: webhook
  submission processing + modals + forum-thread logging + Google Sheets sync.
  **No database**, owner/role checks only.

Neither fits today's core, which **unconditionally** connects to MongoDB
(`ready.js` always runs `new Settings().initialize()` → imports `#db` → eager
`createConnection`) and assumes the department Settings + Permissions model.

## The problem: the kernel bundles four separable layers

| Layer           | What it is                                               | residency           | flu       | dept bots |
| --------------- | -------------------------------------------------------- | ------------------- | --------- | --------- |
| **kernel**      | client, loaders, ErrorHandler, Sentry, Util, base config | ✅                  | ✅        | ✅        |
| **db**          | the Mongo connection (`#db`)                             | ✅ (request schema) | ❌        | ✅        |
| **settings**    | per-guild dynamic config in Mongo + guild-init gate      | ❌ (static)         | ❌        | ✅        |
| **permissions** | the ladder + role→tier resolution                        | own ladder          | `isOwner` | ✅        |

The goal is to make `db` / `settings` / `permissions` **opt-in capabilities**
that a bot pulls in only when a feature needs them, while the kernel keeps only
what every bot needs.

## Tiers

```
src/core/                 KERNEL — always present, no DB, no domain policy
  bot.js                    client, event/feature loaders, seam initialization
  events/                   ready, interactionCreate, guildDelete (shells)
  modules/                  ErrorHandler, Sentry, Util, Features, ladder factory? (see below)
  config.js                 clientId, botToken, owners, nodeEnv, game  (NO mongo)
  capabilities/             CAPABILITY TIER — opt-in, resolved via requires/closure
    db/                       Mongo connection; owns `mongo`; provides #db
    settings/                 requires db; settings model + Settings module +
                              buildSettingsModel + guild-init gate + /config command
    permissions/              requires []; policy-free: createLadder + resolver
                              plumbing + reusable settings-role helper
src/features/             FEATURE TIER — domain capability
  department/               parent-feature: installs the dept ladder
    loa/ logs/ pager/ action/   subfeatures
    lib/                        postToDeptLog, dept color choices
  ingame/                   shared lib (no index)
  autolog/ watchlist/       top-level; requires department/logs and/or ingame
  residency/                parent + badge-walk, user-info subfeatures
  flu/                      standalone
```

A **capability is a feature manifest** (`{commands, events, settings, config,
init, migrate, schedules}`) that simply (a) lives in `src/core/capabilities/`,
(b) loads before domain features, and (c) may fill a kernel seam in its `init`.
No new manifest fields. The cardinal rule holds: the kernel reads seams, never
imports or names a capability/feature.

## The four kernel seams

The three direct base→subsystem imports become indirections so the kernel owns
no DB/settings/permissions code:

| Today                                                                          | Seam                                                                                                                         | Filled by                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `ready.js` imports `Settings`, `Settings.initialize()` runs migrate internally | kernel runs **migrate** hooks in the ready sequence, then capability `init` in `requires` order                              | settings cap `init` builds model + loads cache |
| `interactionCreate.js` imports `Permissions`                                   | `client.permissions` resolver — `{ has, checkSubcommandPermission, getPermissionError }`; base calls `client.permissions?.…` | permissions cap, or a feature's own `init`     |
| `interactionCreate.js` reads `client.settings.has(guild)`                      | `client.gates = []` — each gate `(interaction, command) => blockMessage \| null`                                             | settings cap pushes the guild-init gate        |
| `Util.close()` imports `#db`                                                   | `client.shutdownHooks = []`                                                                                                  | db cap pushes `() => db.close()`               |

The permission resolver is intentionally **duck-typed**, so heterogeneous
permission models coexist across bots. `getRoleIds` is evaluated **lazily per
interaction**, so the permissions capability needs no ordering dependency on
settings — it just asks "is `client.settings` here right now?".

## Policy-free permissions + `createLadder`

`createLadder({ levels, getRoleIds })` lives in the **`permissions` capability**
(`requires: []`, DB-free). It bakes the two **universal** top tiers — owner
(from `#config` `owners`) and Discord `Administrator` — above the injected
`levels`. The capability ships **only** the factory, the resolver/gate plumbing,
and a reusable settings-role helper. It **names no tiers and installs no ladder**.

Each bot installs its own ladder (fully symmetric — no privileged default):

```js
// getRoleIds: settings-backed when settings present, else static config
const getRoleIds = (m, key) => m.client.settings?.get(m.guild)?.roles?.[key] ?? STATIC?.[key];
```

- **department** — the `department` parent-feature installs the dept ladder in
  `init` with settings-backed roles, and owns the `roles` settings fragment +
  `/config roles`. (Absorbs the formerly-separate "department-permissions".)
- **residency** — own 5-level ladder + static `#config` roles, installed in the
  residency feature `init`.
- **flu** — own 2-level ladder `{ flu: 1, owner: 2 }` + static roles. Slash
  commands use declarative `permissions: "flu"`; button accept/deny handlers
  call `client.permissions.has(m, "flu")` directly (buttons bypass the command
  path).

"DB functionality of permissions" is precisely **the per-guild role→tier mapping
stored in the settings document, editable via `/config roles`** — nothing else.
It's an optional, auto-detected enhancement, not a requirement.

## `db` / `settings` capabilities

- **db** — owns the Mongo connection; `mongo` moves out of `src/core/config.js`
  into here; `#db` repoints here; pushes the shutdown hook.
- **settings** — `requires: [db]`. Owns the settings model + `Settings` module +
  `buildSettingsModel` + the guild-init gate + the **relocated `/config`
  command** (a feature `config` fragment is a settings write, so it's meaningless
  without settings). Base subcommands narrow to `reload`/`init`/`edit`. **The
  kernel ships zero commands.** The base settings schema shrinks to
  `guild_id` + `color` (generic); `roles` and `action_log_channel` are
  department policy and move into the department feature.

## Nested subfeatures

Runtime is nearly free: `loadFeatures()` recurses **one level** — for each
feature dir, scan its subdirs for `index.js` (dirs without one, e.g. `lib/`,
skip themselves, exactly as `ingame` does). Subfeature manifests join the flat
list and flow through every existing seam unchanged.

The hierarchy lives in **directory layout + `features.json` + sync selection** —
deliberately invisible to the settings model and `/config`:

- **Subfeature settings**: flat merge (treated identically to feature fragments,
  distinct top-level keys by convention), NOT nested under a parent key.
- **Subfeature `/config`**: a flat distinct-named subcommand, NOT subcommand-
  group nesting.

Both are additive extensions for later if a real need appears.

`features.json` gains `capabilities` and per-feature `subfeatures`:

```jsonc
{
  "capabilities": {
    "db": { "requires": [] },
    "settings": { "requires": ["db"] },
    "permissions": { "requires": [] },
  },
  "features": {
    "department": {
      "requires": ["permissions", "settings"],
      "subfeatures": { "loa": {}, "logs": {}, "pager": {}, "action": {} },
    },
    "ingame": { "requires": [] },
    "autolog": { "requires": ["ingame", "department/logs"] },
    "watchlist": { "requires": ["ingame"] },
    "residency": {
      "requires": ["permissions", "db"],
      "subfeatures": { "badge-walk": {}, "user-info": {} },
    },
    "flu": { "requires": ["permissions"] },
  },
}
```

Selection syntax in `bots/*.json`: `"residency"` = parent + all subs;
`"residency/badge-walk"` = parent + that sub. Selecting any subfeature pulls its
parent (and the parent's `requires`); the dept ladder is installed by the
`department` parent's `init`, so its subfeatures need no explicit ladder edge.

## Department restructure

`loa`/`logs`/`pager`/`action` become **subfeatures** of a `department` parent.
The parent installs the ladder, owns `roles` + `action_log_channel` +
`/config roles`, and has a `lib/` for the **relocated kernel helpers**:

- `Util.postToDeptLog` (reads `settings.action_log_channel`) → `department/lib/`.
- `getEmbedColorChoices({ includeDept: true })` branch → `department/lib/`
  (generic color choices stay in kernel `Util`).

`action_log_channel` is **shared** (loa posts to it via `postToDeptLog`, and
action reads it), so it lives in the **department parent** settings fragment, not
the `action` subfeature.

ingame/autolog/watchlist stay top-level; `autolog requires department/logs`
(cross-hierarchy edge). ridgeway + harrison manifests both list `"department"`;
ridgeway adds `"ingame-suite"`.

## Sync changes (`bin/sync-bot.mjs`)

- Resolve a closure that includes `capabilities` and nested `subfeatures`.
- Copy kernel always; copy `src/core/capabilities/<c>/` only for entitled caps.
- Copy a feature's `index.js` + `lib/` always; copy only selected subfeature
  subdirs.
- Per-capability and per-feature deps (e.g. `mongoose` only when `db` entitled).
- Add the `#capabilities/*` import alias; repoint `#db`.

## Sequencing

1. **Kernel seams** (this change) — add the four seams; existing
   Settings/Permissions are wired _through_ them, no behavior change. Verify
   ridgeway + harrison still sync + boot.
2. **Extract capabilities** — move db/settings/permissions into
   `src/core/capabilities/`; repoint aliases; move `mongo`, `roles`, `/config`.
3. **Sync rewrite** — capability closure + selective copy + per-cap deps.
4. **Nested subfeatures** — loader recursion + `features.json` hierarchy +
   selection syntax + selective subfeature copy.
5. **Migrations** — department restructure (move loa/logs/pager/action under
   `department/`, relocate helpers) + residency (+ subfeatures) + flu.

Steps 1–2 are verifiable against the existing two bots before any new bot is
touched.

## Known limitation

A generated bot has exactly **one** `client.permissions` — perfect for every
real bot. Only the all-features monorepo dev-run could see multiple features race
to set it (last-write-wins). Documented and accepted; no real bot mixes the
residency/flu families with department features.
