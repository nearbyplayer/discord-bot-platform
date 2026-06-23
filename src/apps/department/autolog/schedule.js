import { autoLog } from "#apps/department/ingame/config";
import ActiveSchema from "./schema.js";
import AutoLogs from "./module.js";
import { findInGame } from "#apps/department/ingame/lookup";
import { captureException } from "#modules/Sentry";
import { DateTime } from "luxon";

export const name = "game";
export const schedule = "0,30 * * * * *";
export const runOnStart = true;

let isFirstRun = true;

// Runs every 30s, so transient API failures are routine. Only report to Sentry
// once per sustained outage (~5 minutes of consecutive failures).
const FETCH_FAILURE_REPORT_THRESHOLD = 10;
let consecutiveFetchFailures = 0;

async function fetchData(client) {
  try {
    const response = await fetch(autoLog.apiUrl, {
      headers: { "x-api-key": autoLog.apiKey },
    });
    if (!response.ok) throw new Error(`Error fetching server data (HTTP ${response.status}).`);

    const data = await response.json();
    consecutiveFetchFailures = 0;

    if (Array.isArray(data) && data.length === 0) {
      client.logs.fail = (client.logs.fail + 1) % 4;
      return false;
    }

    client.logs.cache = data;
    client.logs.fail = 0;
    return true;
  } catch (e) {
    consecutiveFetchFailures++;
    captureException(
      e,
      { module: "game", function: "fetchData", consecutive_failures: consecutiveFetchFailures },
      { report: consecutiveFetchFailures === FETCH_FAILURE_REPORT_THRESHOLD },
    );
    return false;
  }
}

async function checkActive(client, start) {
  if (client.logs.checking) return;
  client.logs.checking = true;

  try {
    const logs = await ActiveSchema.find({}).exec();
    for (const log of logs) {
      try {
        const ig = findInGame(client.logs.cache, log.username) === log.team;
        if (!ig) {
          await AutoLogs.submit(client, log, undefined, start);
        } else {
          log.last_active = DateTime.now().toISO();
          await log.save().catch(e => {
            // The active log can be deleted concurrently (submit/cancel) between
            // the find above and this save - a benign race, not an error.
            if (e.name !== "VersionError" && e.name !== "DocumentNotFoundError") throw e;
          });
        }
      } catch (e) {
        captureException(e, { module: "game", function: "checkActive", username: log.username });
      }
    }
  } catch (e) {
    captureException(e, { module: "game", function: "checkActive" }, { report: true });
  }

  client.logs.checking = false;
}

/**
 * @param {import('discord.js').Client} client
 */
export async function execute(client) {
  if (!client.logs) {
    client.logs = { cache: [], checking: false, fail: 0 };
  }

  if (!autoLog.enabled) return;

  const start = isFirstRun;
  isFirstRun = false;

  const fetched = await fetchData(client);
  if (!fetched) return;

  await checkActive(client, start);
}
