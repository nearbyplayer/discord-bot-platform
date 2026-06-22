import { buildSettingsModel } from "./schema.js";
import { captureException } from "#modules/Sentry";
import { ConfigError, DatabaseError } from "#src/errors";

/**
 * Centralized manager for guild settings operations.
 * Wraps Mongoose documents with validation, error handling, and convenient APIs.
 */
export default class Settings {
  /**
   * @param {import('discord.js').Client} client - Discord client instance
   */
  constructor(client) {
    this.client = client;
    this.cache = {};
    this.model = null;
  }

  /**
   * Load all guild settings from database into cache.
   * Called during bot initialization.
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Merge settings fragments from every loaded manifest (capabilities first,
      // then features). Feature `migrate` hooks already ran in the kernel ready
      // sequence, so relocated fields are at their new paths before the cache loads.
      const manifests = [...(this.client.capabilities ?? []), ...(this.client.features ?? [])];

      // Compile the model with manifest settings fragments merged in.
      this.model = buildSettingsModel(manifests);

      const settings = await this.model.find({}).exec();

      for (const setting of settings) {
        this.cache[setting.guild_id] = setting;
      }

      console.log(`Loaded settings for ${settings.length} guild(s)`);
    } catch (error) {
      captureException(error, { context: "Settings.initialize" }, { report: true });
      throw error;
    }
  }

  /**
   * Get settings for a guild.
   * @param {string|import('discord.js').Guild} guild - Guild ID or Guild object
   * @returns {import('./schema.js')|null} Settings document or null if not found
   */
  get(guild) {
    const guildId = typeof guild === "string" ? guild : guild.id;
    return this.cache[guildId] || null;
  }

  /**
   * Check if a guild has settings configured.
   * @param {string|import('discord.js').Guild} guild - Guild ID or Guild object
   * @returns {boolean}
   */
  has(guild) {
    const guildId = typeof guild === "string" ? guild : guild.id;
    return guildId in this.cache;
  }

  /**
   * Ensure settings exist for a guild, creating them if necessary.
   * @param {string} guildId - Guild ID
   * @returns {Promise<import('./schema.js')>} Settings document
   */
  async ensure(guildId) {
    if (this.has(guildId)) {
      return this.get(guildId);
    }

    try {
      const settings = new this.model({ guild_id: guildId });
      await settings.save();
      this.cache[guildId] = settings;
      return settings;
    } catch (error) {
      captureException(
        error,
        {
          context: "Settings.ensure",
          guildId,
        },
        { report: true },
      );
      throw error;
    }
  }

  /**
   * Update a setting using dot notation and auto-save.
   * @param {string|import('discord.js').Guild} guild - Guild ID or Guild object
   * @param {string} path - Dot-notation path (e.g., 'logs.active')
   * @param {*} value - Value to set
   * @returns {Promise<void>}
   * @throws {DatabaseError} If guild is unconfigured or save fails
   */
  async update(guild, path, value) {
    const guildId = typeof guild === "string" ? guild : guild.id;
    const settings = this.get(guildId);

    if (!settings) {
      throw new DatabaseError("Failed to update settings: guild not configured", null, {
        context: "Settings.update",
        guildId,
        path,
      });
    }

    try {
      settings.set(path, value);
      await settings.save();
    } catch (error) {
      captureException(
        error,
        {
          context: "Settings.update",
          guildId,
          path,
        },
        { report: true },
      );
      throw new DatabaseError("Failed to save settings to database", error, {
        context: "Settings.update",
        guildId,
        path,
      });
    }
  }

  /**
   * Update multiple settings using dot notation and save once.
   * @param {string|import('discord.js').Guild} guild - Guild ID or Guild object
   * @param {Array<[string, *]>} updates - List of [path, value] pairs
   * @returns {Promise<void>}
   * @throws {DatabaseError} If guild is unconfigured or save fails
   */
  async updateMany(guild, updates) {
    const guildId = typeof guild === "string" ? guild : guild.id;
    const settings = this.get(guildId);
    const paths = updates.map(([path]) => path);

    if (!settings) {
      throw new DatabaseError("Failed to update settings: guild not configured", null, {
        context: "Settings.updateMany",
        guildId,
        paths,
      });
    }

    try {
      for (const [path, value] of updates) {
        settings.set(path, value);
      }

      await settings.save();
    } catch (error) {
      captureException(
        error,
        {
          context: "Settings.updateMany",
          guildId,
          paths,
        },
        { report: true },
      );
      throw new DatabaseError("Failed to save settings to database", error, {
        context: "Settings.updateMany",
        guildId,
        paths,
      });
    }
  }

  /**
   * Save settings document with error handling.
   * @param {string|import('discord.js').Guild} guild - Guild ID or Guild object
   * @returns {Promise<void>}
   * @throws {DatabaseError} If guild is unconfigured or save fails
   */
  async save(guild) {
    const guildId = typeof guild === "string" ? guild : guild.id;
    const settings = this.get(guildId);

    if (!settings) {
      throw new DatabaseError("Failed to save settings: guild not configured", null, {
        context: "Settings.save",
        guildId,
      });
    }

    try {
      await settings.save();
    } catch (error) {
      captureException(
        error,
        {
          context: "Settings.save",
          guildId,
        },
        { report: true },
      );
      throw new DatabaseError("Failed to save settings to database", error, {
        context: "Settings.save",
        guildId,
      });
    }
  }

  /**
   * Reload settings from database.
   * @param {string} [guildId] - Optional specific guild ID, or reload all if omitted
   * @returns {Promise<void>}
   */
  async reload(guildId) {
    try {
      if (guildId) {
        const settings = await this.model.findOne({ guild_id: guildId }).exec();
        if (settings) {
          this.cache[guildId] = settings;
        } else {
          delete this.cache[guildId];
        }
      } else {
        const settings = await this.model.find({}).exec();
        this.cache = {};
        for (const setting of settings) {
          this.cache[setting.guild_id] = setting;
        }
      }
    } catch (error) {
      captureException(
        error,
        {
          context: "Settings.reload",
          guildId: guildId || "all",
        },
        { report: true },
      );
      throw error;
    }
  }

  /**
   * Remove settings for a guild from both the database and cache.
   * @param {string|import('discord.js').Guild} guild - Guild ID or Guild object
   * @returns {Promise<void>}
   */
  async remove(guild) {
    const guildId = typeof guild === "string" ? guild : guild.id;
    try {
      await this.model.deleteOne({ guild_id: guildId }).exec();
      delete this.cache[guildId];
    } catch (error) {
      captureException(error, { context: "Settings.remove", guildId }, { report: true });
    }
  }

  /**
   * Validate required settings exist, throwing ConfigError if not.
   * @param {string|import('discord.js').Guild} guild - Guild ID or Guild object
   * @param {...string} options - Setting paths to check
   * @throws {ConfigError} If guild is unconfigured or required settings are missing
   */
  requireOrThrow(guild, ...options) {
    const guildId = typeof guild === "string" ? guild : guild.id;
    if (!this.has(guildId)) {
      throw new ConfigError("This guild has not been configured. Please run /config first.");
    }
    if (!this.requires(guild, ...options)) {
      throw new ConfigError(`Guild is missing required configuration: ${options.join(", ")}`);
    }
  }

  /**
   * Validate that required settings exist for a guild.
   * @param {string|import('discord.js').Guild} guild - Guild ID or Guild object
   * @param {...string} options - Setting paths to check
   * @returns {boolean}
   */
  requires(guild, ...options) {
    const settings = this.get(guild);
    if (!settings) return false;

    for (const option of options) {
      const parts = option.split(".");
      let current = settings;

      for (const part of parts) {
        if (
          !current ||
          current[part] === undefined ||
          current[part] === null ||
          current[part] === ""
        ) {
          return false;
        }
        current = current[part];
      }
    }

    return true;
  }
}
