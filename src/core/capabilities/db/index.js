/**
 * Database capability.
 * Owns the Mongo connection (exported as `#db` from ./connection.js) and
 * registers its teardown into the kernel shutdown seam. Opt-in: only bots whose
 * features need persistence entitle this capability.
 */
import connection from "./connection.js";

export default {
  name: "db",
  init: client => {
    client.shutdownHooks.push(() => connection.close());
  },
};
