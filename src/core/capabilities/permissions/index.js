/**
 * Permissions capability.
 * Policy-free: it provides the `createLadder` factory and nothing else - it
 * names no permission tiers and installs no ladder. Each bot installs its own
 * resolver into `client.permissions` from a feature's `init` (e.g. the
 * `department` feature). `requires: []` and DB-free.
 */
export { createLadder } from "./ladder.js";

export default {
  name: "permissions",
};
