import { captureException } from "#modules/Sentry";

function normalizeUsername(username) {
  return username
    .split("")
    .filter(char => char.charCodeAt(0) <= 127)
    .join("");
}

/**
 * Find a player in game and return the matching server/player pair.
 * @param {Array} data - Server list from API
 * @param {string} username - Player username to search for
 * @returns {{server: object, player: object}|undefined}
 */
export function findPlayerInGame(data, username) {
  if (!data) {
    captureException(new Error("Data was not provided to findPlayerInGame!"), {
      module: "InGame",
      function: "findPlayerInGame",
    });
    return undefined;
  }

  const asciiUsername = normalizeUsername(username);

  for (const server of data) {
    if (server.GameID !== 8515962730) continue;
    const player = server.Information?.Players?.find(p => p.Username === asciiUsername);
    if (player) return { server, player };
  }

  return undefined;
}

/**
 * Find a player in game and return their team acronym.
 * Filters out non-ASCII characters from username for matching.
 * @param {Array} data - Server list from API
 * @param {string} username - Player username to search for
 * @returns {string|undefined} - Team acronym or undefined if not found
 */
export function findInGame(data, username) {
  const found = findPlayerInGame(data, username);
  return found?.player?.Acronym;
}
