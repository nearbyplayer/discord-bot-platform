/**
 * Feature loader.
 * Scans src/features/<name>/index.js and returns each feature's manifest:
 * { name, commands?, events?, schedules? }. Subdirectories without an index.js
 * (e.g. shared libraries like `ingame`) are skipped. Returns [] when there is no
 * features directory, so the base loaders no-op in deployments that ship without
 * any features.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { captureException } from "#modules/Sentry";

const featuresPath = join(process.cwd(), "src", "features");

export async function loadFeatures() {
  if (!existsSync(featuresPath)) return [];

  const features = [];
  for (const entry of readdirSync(featuresPath)) {
    const dir = join(featuresPath, entry);
    if (!statSync(dir).isDirectory()) continue;

    const indexPath = join(dir, "index.js");
    if (!existsSync(indexPath)) continue;

    try {
      const { default: feature } = await import(pathToFileURL(indexPath).href);
      if (feature) features.push(feature);
    } catch (error) {
      captureException(
        error,
        { module: "Features", action: "load", feature: entry },
        { report: true },
      );
    }
  }

  return features;
}
