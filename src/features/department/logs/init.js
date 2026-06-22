import { ensureGuildMembersCached } from "#modules/Util";
import { captureException } from "#modules/Sentry";

/**
 * Warm member caches only for guilds that use log quotas so role membership checks
 * do not depend on partial gateway cache state during /log commands.
 * Runs non-blocking (detached void async) so init returns immediately.
 * @param {import('discord.js').Client} client
 */
export default async client => {
  void (async () => {
    for (const guild of client.guilds.cache.values()) {
      const settings = client.settings.get(guild);
      const hasLogQuotas =
        settings?.logs?.quota?.size > 0 || settings?.logs?.special_quota?.size > 0;

      if (!hasLogQuotas) continue;

      try {
        await ensureGuildMembersCached(guild, { force: true });
      } catch (error) {
        captureException(error, {
          event: "ClientReady",
          action: "warmGuildMembers",
          guildId: guild.id,
        });
      }
    }
  })();
};
