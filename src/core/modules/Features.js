/**
 * Manifest loader.
 * Scans a directory of <name>/index.js manifests and returns each one.
 * Subdirectories without an index.js (e.g. shared libraries like `ingame`) are
 * skipped. Used for both the capability tier (src/core/capabilities) and the
 * feature tier (src/features); a missing directory yields [], so base loaders
 * no-op in deployments that ship without that tier.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { captureException } from "#modules/Sentry";

const featuresPath = join(process.cwd(), "src", "features");
const capabilitiesPath = join(process.cwd(), "src", "core", "capabilities");

async function importManifest(indexPath, manifests, kind, label) {
  try {
    const { default: manifest } = await import(pathToFileURL(indexPath).href);
    if (manifest) manifests.push(manifest);
  } catch (error) {
    captureException(
      error,
      { module: "Features", action: "load", kind, name: label },
      { report: true },
    );
  }
}

async function loadManifests(basePath, kind, { recurse = false } = {}) {
  if (!existsSync(basePath)) return [];

  const manifests = [];
  for (const entry of readdirSync(basePath)) {
    const dir = join(basePath, entry);
    if (!statSync(dir).isDirectory()) continue;

    const indexPath = join(dir, "index.js");
    if (!existsSync(indexPath)) continue; // shared lib (no index, e.g. ingame) — skip

    await importManifest(indexPath, manifests, kind, entry);

    // One level of nested subfeatures: a parent feature's subdirectories that
    // carry their own index.js load as flat manifests too (lib/ subdirs without
    // an index are skipped). They flow through every seam like any feature.
    if (!recurse) continue;
    for (const sub of readdirSync(dir)) {
      const subDir = join(dir, sub);
      if (!statSync(subDir).isDirectory()) continue;

      const subIndexPath = join(subDir, "index.js");
      if (!existsSync(subIndexPath)) continue;

      await importManifest(subIndexPath, manifests, kind, `${entry}/${sub}`);
    }
  }

  return manifests;
}

export function loadFeatures() {
  return loadManifests(featuresPath, "feature", { recurse: true });
}

export function loadCapabilities() {
  return loadManifests(capabilitiesPath, "capability");
}
