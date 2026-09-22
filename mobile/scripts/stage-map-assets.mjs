/*! Open Historia — fetch the map data the Android app ships © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The world map is not in git (see docs/assets-and-data.md); the desktop
// downloads it at first launch and the website streams it from a content node.
// The Android app carries it INSIDE the APK instead, so a phone plays in
// airplane mode from the first tap. This fetches the six files listed in
// map-assets.android.json from the map-data GitHub Release into map-cache/
// (gitignored), verifies every byte against the pinned sha256, and skips a file
// that is already there and correct — so a rebuild costs nothing and CI can
// cache the folder by the manifest's hash.
//
// Node built-ins only, like scripts/fetch-map-assets.mjs, which it mirrors.

import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const mobileDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(mobileDir, "map-assets.android.json");
export const MAP_CACHE_DIR = path.join(mobileDir, "map-cache");
const RELEASE_BASE = process.env.OH_MAP_DATA_BASE
  || "https://github.com/Open-Historia/open-historia/releases/download";

export const readAndroidMapManifest = () => JSON.parse(readFileSync(manifestPath, "utf8"));

const sha256Of = (filePath) => {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
};

const isGood = (filePath, entry) => {
  if (!existsSync(filePath)) return false;
  if (statSync(filePath).size !== entry.bytes) return false;
  return sha256Of(filePath) === entry.sha256;
};

const download = async (url, filePath) => {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const partial = `${filePath}.download`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, filePath);
};

export const stageMapAssets = async ({ log = console.log } = {}) => {
  const manifest = readAndroidMapManifest();
  mkdirSync(MAP_CACHE_DIR, { recursive: true });
  const staged = [];
  for (const entry of manifest.assets) {
    const target = path.join(MAP_CACHE_DIR, entry.asset);
    if (isGood(target, entry)) {
      log(`  ${entry.asset}: present (${entry.bytes} bytes, verified)`);
      staged.push({ ...entry, file: target });
      continue;
    }
    const url = `${RELEASE_BASE}/${manifest.release}/${entry.asset}`;
    log(`  ${entry.asset}: downloading ${entry.bytes} bytes…`);
    rmSync(target, { force: true });
    await download(url, target);
    if (!isGood(target, entry)) {
      rmSync(target, { force: true });
      throw new Error(`${entry.asset} did not match the pinned size/sha256 after download — refusing to ship it.`);
    }
    log(`  ${entry.asset}: verified`);
    staged.push({ ...entry, file: target });
  }
  return staged;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log("Staging the Android map data into mobile/map-cache/:");
  stageMapAssets().then((staged) => {
    const total = staged.reduce((sum, entry) => sum + entry.bytes, 0);
    console.log(`${staged.length} files, ${(total / 1048576).toFixed(1)} MB.`);
  }).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
