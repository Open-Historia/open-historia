/*! Open Historia — scenario bundles under the project's current name © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Scenario bundles written before 2026-09-29 carry the project's earlier name in
// their schema ("<name>-scenario-bundle", or ".../2"). The importers read either
// (libraryStore.js isScenarioBundleSchema) and every export says the current
// name. This rewrites the name inside a bundle's bytes, so the copies the game
// keeps of what players downloaded — the Hub download cache (server.js,
// /api/hub/file) — say the current name too: each download as it arrives, and
// what was already cached, once, when the server starts.
//
// Only the schema's value changes, at the format it already had (1 or 2); every
// other byte of a JSON bundle stays as it was. A zipped bundle (scenario.json
// beside its basemap and preview) has its scenario.json rewritten and is zipped
// again with the same entries.

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

export const SCENARIO_BUNDLE_NAME = "open-historia";

// A bundle's schema, wherever it sits: at the top of a scenario file, or inside
// a game file that carries its scenario.
const SCHEMA_FIELD = /"schema"(\s*):(\s*)"([a-z][a-z0-9-]*)-scenario-bundle(\/2)?"/g;

export const renameScenarioBundleText = (text) => {
  let changed = false;
  const renamed = String(text).replace(SCHEMA_FIELD, (field, beforeColon, afterColon, name, format = "") => {
    if (name === SCENARIO_BUNDLE_NAME) return field;
    changed = true;
    return `"schema"${beforeColon}:${afterColon}"${SCENARIO_BUNDLE_NAME}-scenario-bundle${format}"`;
  });
  return { text: changed ? renamed : String(text), changed };
};

const isZip = (bytes) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
const isJsonObject = (bytes) => {
  for (let index = 0; index < Math.min(bytes.length, 64); index += 1) {
    const byte = bytes[index];
    if (byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0xef || byte === 0xbb || byte === 0xbf) continue;
    return byte === 0x7b; // "{"
  }
  return false;
};

// { bytes, changed } for any downloaded file: a JSON bundle, a zipped one, or
// anything else (a basemap image, a flag), which comes back untouched.
export const renameScenarioBundleBytes = async (input) => {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (isZip(bytes)) {
    let zip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      return { bytes, changed: false };
    }
    const entry = zip.file("scenario.json");
    if (!entry) return { bytes, changed: false };
    const { text, changed } = renameScenarioBundleText(await entry.async("string"));
    if (!changed) return { bytes, changed: false };
    zip.file("scenario.json", text);
    return { bytes: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), changed: true };
  }
  if (!isJsonObject(bytes) || bytes.indexOf("-scenario-bundle") < 0) return { bytes, changed: false };
  const { text, changed } = renameScenarioBundleText(bytes.toString("utf8"));
  return changed ? { bytes: Buffer.from(text, "utf8"), changed: true } : { bytes, changed: false };
};

// Writes beside and renames over, so a concurrent read never sees half a file.
export const writeFileAtomic = (file, bytes) => {
  fs.writeFileSync(`${file}.tmp`, bytes);
  fs.renameSync(`${file}.tmp`, file);
};

// Every cached download under the current name, once: a marker in the cache
// says the pass is done, and every download since is renamed as it arrives.
// Resolves to how many files it rewrote; a file it cannot read is left alone.
export const HUB_CACHE_NAMES_MARKER = "bundle-names-current";
export const renameHubCacheBundles = async (cacheDir) => {
  const marker = path.join(cacheDir, HUB_CACHE_NAMES_MARKER);
  if (!fs.existsSync(cacheDir) || fs.existsSync(marker)) return 0;
  let rewritten = 0;
  for (const name of fs.readdirSync(cacheDir)) {
    if (!name.endsWith(".body")) continue;
    const file = path.join(cacheDir, name);
    try {
      const { bytes, changed } = await renameScenarioBundleBytes(fs.readFileSync(file));
      if (!changed) continue;
      writeFileAtomic(file, bytes);
      rewritten += 1;
    } catch {
      // Left as it was: the importer still reads the earlier name.
    }
  }
  fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
  return rewritten;
};
