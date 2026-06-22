/**
 * MongoDB connection instance (db capability).
 * Schemas bind to this connection via the `#db` import rather than the default
 * global mongoose connection. The connection string lives here, not in the base
 * config, so a bot without the db capability never reads MONGO.
 */
import { createConnection } from "mongoose";

const mongo = process.env.MONGO || "";

export default createConnection(mongo, { socketTimeoutMS: 30000 });
