import { executeCron } from "./module.js";

export const name = "loa";
export const schedule = "0 0 * * *";
export const runOnStart = true;

/**
 * @param {import('discord.js').Client} client
 */
export async function execute(client) {
  await executeCron(client);
}
