/**
 * Department parent-feature.
 * Houses the department subfeatures (loa, logs, pager, action) and owns the
 * department-wide policy: it installs the department permission ladder via the
 * policy-free `createLadder` factory, and contributes the department settings
 * (`roles` + `action_log_channel`) and their `/config` fragments. Selecting any
 * subfeature pulls this parent in, so the ladder is always installed.
 */
import { Schema } from "mongoose";

import { createLadder } from "#capabilities/permissions/ladder";
import config from "./config.js";

// Custom department levels; createLadder bakes owner + Administrator on top.
const DEPARTMENT_LEVELS = ["employee", "command", "ia", "high_command"];

// Dominance graph (partial order). High Command sits above BOTH Command and
// Internal Affairs; Command sits above Employee. Internal Affairs is a SEPARATE
// track: it does not satisfy Command, and Command does not satisfy IA. So an
// IA-gated command is satisfied by IA -> High Command -> Administrator -> Owner.
const DEPARTMENT_DOMINANCE = {
  high_command: ["command", "ia"],
  command: ["employee"],
};

// Map a ladder level name to its settings role key (high_command stores under `high`).
const roleKey = levelName => (levelName === "high_command" ? "high" : levelName);

export default {
  name: "department",
  config,
  settings: {
    action_log_channel: { type: String, default: "" },
    roles: {
      type: new Schema(
        {
          employee: { type: [String], default: [] },
          command: { type: [String], default: [] },
          high: { type: [String], default: [] },
          ia: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
  },
  init: client => {
    client.permissions = createLadder({
      levels: DEPARTMENT_LEVELS,
      dominates: DEPARTMENT_DOMINANCE,
      acronyms: ["ia"],
      // Settings-backed roles, evaluated lazily per interaction.
      getRoleIds: (member, levelName) =>
        member.client.settings?.get(member.guild)?.roles?.[roleKey(levelName)],
    });
  },
};
