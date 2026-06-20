// Node Modules
import { owners } from "#config";
import { ValidationError } from "#src/errors";
import { PermissionFlagsBits } from "discord.js";

/**
 * Permission utilities and metadata-based permission handling.
 */
export default class Permissions {
  static LEVEL_VALUES = {
    employee: 1,
    command: 2,
    ia: 3,
    high_command: 4,
    administrator: 5,
    owner: 6,
  };

  static getConfiguredRoleIds(member, key) {
    const settings = member.client.settings.get(member.guild);
    const roles = settings?.roles;
    const ids = roles?.[key];
    return Array.isArray(ids) && ids.length > 0 ? ids : null;
  }

  static hasConfiguredRole(member, key) {
    const roleIds = Permissions.getConfiguredRoleIds(member, key);
    if (!roleIds) return false;
    return member.roles.cache.hasAny(...roleIds);
  }

  static normalizeLevel(level) {
    if (typeof level !== "string") return null;
    const normalized = level.toLowerCase();
    return Permissions.LEVEL_VALUES[normalized] ? normalized : null;
  }

  static level(member) {
    if (owners.includes(member.id)) return "owner";
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return "administrator";
    if (Permissions.hasConfiguredRole(member, "high")) return "high_command";
    if (Permissions.hasConfiguredRole(member, "ia")) return "ia";
    if (Permissions.hasConfiguredRole(member, "command")) return "command";
    if (Permissions.hasConfiguredRole(member, "employee")) return "employee";
    return null;
  }

  static has(member, requiredLevel) {
    const normalizedLevel = Permissions.normalizeLevel(requiredLevel);
    if (!normalizedLevel) {
      console.error(`Unknown permission level: ${requiredLevel}`);
      return false;
    }

    const currentLevel = Permissions.level(member);
    if (!currentLevel) return false;

    return Permissions.LEVEL_VALUES[currentLevel] >= Permissions.LEVEL_VALUES[normalizedLevel];
  }

  static require(member, requiredLevel, message = null) {
    if (Permissions.has(member, requiredLevel)) return;

    throw new ValidationError(message || Permissions.getPermissionError(requiredLevel));
  }

  static getPermissionError(requiredLevel = null) {
    const normalizedLevel = Permissions.normalizeLevel(requiredLevel);
    if (!normalizedLevel) return "You do not have permission to run this command.";

    const acronyms = new Set(["ia"]);
    const display = normalizedLevel
      .split("_")
      .map(word =>
        acronyms.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
      )
      .join(" ");
    return `You need ${display}+ permissions to run this command.`;
  }

  static checkSubcommandPermission(command, interaction) {
    if (typeof command.permissions !== "object") {
      return command.permissions;
    }

    const subcommand = interaction.options.getSubcommand(false);
    if (!subcommand) {
      return command.permissions.default || null;
    }

    return command.permissions.subcommands?.[subcommand] || command.permissions.default || null;
  }
}
