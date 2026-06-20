/**
 * MongoDB connection instance.
 * All schemas use this connection rather than the default mongoose connection.
 */
import { createConnection } from "mongoose";
import { mongo } from "#config";

export default createConnection(mongo, { socketTimeoutMS: 30000 });
