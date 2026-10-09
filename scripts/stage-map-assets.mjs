/*! Open Historia — fetch the map data a web build carries © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The world map is not in git (see docs/assets-and-data.md). Every build gets
// it the same way: a list pins each file of the map-data GitHub Release by size
// and sha256, a script downloads what is missing and verifies every byte, and
// the app reads the files from its own /assets folder.
//
//   the desktop app   scripts/map-assets.json      fetched at first launch
//   the website       scripts/map-assets.web.json  fetched when the site is built
//   the Android app   scripts/map-assets.web.json  fetched when the APK is built
//
// This is the second and third of those. A browser cannot read a release asset
// itself (GitHub sends no CORS header on the download), so the website carries
// its copy as the Android app does: `npm run build:web` / `build:site` lay the
// files under <outDir>/assets/, and the page reads them from its own origin.
// Every file in the list has to fit Cloudflare Pages' 25 MiB limit, which is
// why this list holds the z8 trims and the web-sized world, not the desktop's.
//
//   node scripts/stage-map-assets.mjs                 download + verify into map-cache/
//   node scripts/stage-map-assets.mjs dist-web        … and lay the files into dist-web/assets/
//   node scripts/stage-map-assets.mjs public --missing-only
//                                                     … only the files that folder lacks (dev:web)
//
// Node built-ins only, like scripts/fetch-map-assets.mjs, which it mirrors.
// Unlike that script this one FAILS when a file cannot be had: a site or an
// APK built without its map is not something to ship.

import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(repoRoot, "scripts", "map-assets.web.json");
// One cache for the website and the Android build (gitignored). mobile/ keeps
// its old folder name working by pointing here (mobile/scripts/stage-map-assets.mjs).
export const MAP_CACHE_DIR = process.env.OH_MAP_CACHE_DIR
  ? path.resolve(process.env.OH_MAP_CACHE_DIR)
  : path.join(repoRoot, "map-cache");
const RELEASE_BASE = process.env.OH_MAP_DATA_BASE
  || "https://github.com/Open-Historia/open-historia/releases/download";

// Cloudflare Pages refuses any file over this (and reports the deploy as a
// success first). The deploy workflow checks the built site; this keeps a file
// that cannot ship out of the list in the first place.
export const SITE_FILE_LIMIT_BYTES = 25 * 1024 * 1024;

export const readWebMapManifest = () => JSON.parse(readFileSync(manifestPath, "utf8"));

const sha256Of = (filePath) => createHash("sha256").update(readFileSync(filePath)).digest("hex");

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

// Every file of the list, present in the cache and verified. Returns the
// entries with the cached file's path.
export const stageMapAssets = async ({ log = console.log, cacheDir = MAP_CACHE_DIR } = {}) => {
  const manifest = readWebMapManifest();
  mkdirSync(cacheDir, { recursive: true });
  const staged = [];
  for (const entry of manifest.assets) {
    const target = path.join(cacheDir, entry.asset);
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

// The staged files laid under a build's folder at the stable names the app
// asks for (entry.path, e.g. assets/regions.pmtiles). `missingOnly` leaves a
// file that is already there alone, whatever it is: a developer's public/
// holds the desktop's copies under the same names, and those must stay.
export const layMapAssets = (staged, outDir, { missingOnly = false } = {}) => {
  let laid = 0;
  let bytes = 0;
  for (const entry of staged) {
    const to = path.join(outDir, entry.path);
    if (missingOnly && existsSync(to)) continue;
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(entry.file, to);
    laid += 1;
    bytes += entry.bytes;
  }
  return { laid, bytes };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const missingOnly = args.includes("--missing-only");
  const outArg = args.find((arg) => !arg.startsWith("--"));
  console.log(`Staging the web build's map data into ${path.relative(repoRoot, MAP_CACHE_DIR) || "."}/:`);
  stageMapAssets().then((staged) => {
    const total = staged.reduce((sum, entry) => sum + entry.bytes, 0);
    console.log(`${staged.length} files, ${(total / 1048576).toFixed(1)} MB.`);
    if (!outArg) return;
    const outDir = path.resolve(repoRoot, outArg);
    if (!existsSync(outDir)) throw new Error(`${outArg}/ does not exist — build first, then stage into it.`);
    const { laid, bytes } = layMapAssets(staged, outDir, { missingOnly });
    console.log(`${laid} file(s), ${(bytes / 1048576).toFixed(1)} MB, laid under ${outArg}/${missingOnly ? " (only what it lacked)" : ""}.`);
  }).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
