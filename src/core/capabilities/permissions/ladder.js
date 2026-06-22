// Node Modules
import { PermissionFlagsBits } from "discord.js";

// Bot Modules
import { owners } from "#config";
import { ValidationError } from "#src/errors";

/**
 * Build a permission resolver from a set of custom levels and an optional
 * dominance graph, plus an injected role source. Two universal tiers are baked
 * in above every custom level: `owner` (from #config `owners`) and
 * `administrator` (Discord Administrator permission) - both satisfy every level.
 *
 * The dominance graph models a partial order, not just a linear ladder: a level
 * "dominates" the levels listed for it (and, transitively, theirs), meaning
 * holding it satisfies them. Levels that don't dominate each other are separate
 * tracks - e.g. Internal Affairs and Command both sit under High Command but
 * neither satisfies the other. When `dominates` is omitted, `levels` is treated
 * as a single linear chain (each level dominates the one before it).
 *
 * DB-free by construction: persistence, if any, lives entirely in the injected
 * `getRoleIds`, so this factory has no settings/db dependency.
 *
 * @param {object} opts
 * @param {string[]} opts.levels - All custom level names (lowest -> highest if linear).
 * @param {Record<string, string[]>} [opts.dominates] - level -> levels it directly satisfies.
 * @param {(member: import('discord.js').GuildMember, levelName: string) => string[]|undefined} opts.getRoleIds
 * @param {string[]} [opts.acronyms] - Level-name words to render uppercase in errors (e.g. ["ia"]).
 * @returns {{ has: Function, require: Function, getPermissionError: Function,
 *   checkSubcommandPermission: Function, normalizeLevel: Function }}
 */
export function createLadder({ levels = [], dominates, getRoleIds, acronyms = [] }) {
  const acronymSet = new Set(acronyms.map(a => a.toLowerCase()));
  const customLevels = levels.map(l => l.toLowerCase());

  // Default to a linear chain (each level dominates the previous) when no
  // explicit dominance graph is supplied.
  let edges = dominates;
  if (!edges) {
    edges = {};
    for (let i = 1; i < customLevels.length; i++) {
      edges[customLevels[i]] = [customLevels[i - 1]];
    }
  }

  // Transitive grants: the set of levels each custom level satisfies (itself +
  // everything it dominates, recursively).
  const grantsOf = name => {
    const seen = new Set();
    const stack = [name];
    while (stack.length > 0) {
      const n = stack.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      for (const d of edges[n] ?? []) stack.push(d);
    }
    return seen;
  };
  const closure = {};
  for (const lvl of customLevels) closure[lvl] = grantsOf(lvl);

  const allLevels = new Set([...customLevels, "administrator", "owner"]);

  const normalizeLevel = level => {
    if (typeof level !== "string") return null;
    const normalized = level.toLowerCase();
    return allLevels.has(normalized) ? normalized : null;
  };

  // The set of levels a member satisfies. Owner satisfies everything;
  // Administrator satisfies every custom level (and administrator); a role-holder
  // satisfies the transitive closure of each custom level they hold a role for.
  const grantedLevels = member => {
    if (owners.includes(member.id)) return allLevels;

    const granted = new Set();
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      granted.add("administrator");
      for (const lvl of customLevels) granted.add(lvl);
      return granted;
    }

    for (const lvl of customLevels) {
      const ids = getRoleIds(member, lvl);
      if (Array.isArray(ids) && ids.length > 0 && member.roles.cache.hasAny(...ids)) {
        for (const g of closure[lvl]) granted.add(g);
      }
    }
    return granted;
  };

  const has = (member, requiredLevel) => {
    const normalizedLevel = normalizeLevel(requiredLevel);
    if (!normalizedLevel) {
      console.error(`Unknown permission level: ${requiredLevel}`);
      return false;
    }
    return grantedLevels(member).has(normalizedLevel);
  };

  const getPermissionError = (requiredLevel = null) => {
    const normalizedLevel = normalizeLevel(requiredLevel);
    if (!normalizedLevel) return "You do not have permission to run this command.";

    const display = normalizedLevel
      .split("_")
      .map(word =>
        acronymSet.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
      )
      .join(" ");
    return `You need ${display}+ permissions to run this command.`;
  };

  const require = (member, requiredLevel, message = null) => {
    if (has(member, requiredLevel)) return;
    throw new ValidationError(message || getPermissionError(requiredLevel));
  };

  const checkSubcommandPermission = (command, interaction) => {
    if (typeof command.permissions !== "object") {
      return command.permissions;
    }

    const subcommand = interaction.options.getSubcommand(false);
    if (!subcommand) {
      return command.permissions.default || null;
    }

    return command.permissions.subcommands?.[subcommand] || command.permissions.default || null;
  };

  return { has, require, getPermissionError, checkSubcommandPermission, normalizeLevel };
}
