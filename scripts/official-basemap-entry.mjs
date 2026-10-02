/*! Open Historia — add a detailed map to the official list © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// For maintainers of Open-Historia/Open-Historia-basemaps
// (docs/adr/0006-official-basemap-list.md). Checks a .pmtiles file the way the
// game will, then writes its entry into that repository's basemaps.json: its
// size, its SHA-256 and its release link. Upload the file to the release with
// exactly that tag and file name, then commit basemaps.json.
//
//   node scripts/official-basemap-entry.mjs <file.pmtiles> --id westeros-relief --version 9
//     [--list ../Open-Historia-basemaps/basemaps.json] [--tag westeros-relief-v9]
//     [--name "Westeros & Essos relief"] [--author "…"] [--license "…"]
//     [--notes "What changed"] [--preview <file name in the same release>]
//
// Without --list it only prints the entry. A version already in the list is
// never changed: scenarios trust its checksum, so a new file is a new version.

import fs from "fs";
import path from "path";
import { hashFile, inspectTiledArchive } from "../server/tiledBasemaps.js";
import { OFFICIAL_RELEASES_PREFIX, parseOfficialCatalog } from "../server/officialBasemaps.js";

const CAP = 500 * 1024 * 1024;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const args = process.argv.slice(2);
const file = args.find((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
if (!file) fail("Usage: node scripts/official-basemap-entry.mjs <file.pmtiles> --id <map-id> --version <n> [--list basemaps.json]");

const id = option("id");
const version = Number(option("version"));
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(id || ""))) fail("--id must be lower-case letters, digits and dashes, like westeros-relief.");
if (!Number.isInteger(version) || version < 1) fail("--version must be a whole number from 1.");

const { size } = fs.statSync(file);
if (size > CAP) fail(`The file is ${Math.round(size / 1048576)} MB; the game downloads at most 500 MB.`);
const info = await inspectTiledArchive(file).catch((error) => fail(`The game would refuse this file: ${error.message}`));
const sha256 = await hashFile(file);

const tag = option("tag") || `${id}-v${version}`;
const releaseLink = (name) => `${OFFICIAL_RELEASES_PREFIX}${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
const entry = {
  version,
  url: releaseLink(path.basename(file)),
  bytes: size,
  sha256,
  ...(option("preview") ? { preview: releaseLink(option("preview")) } : {}),
  ...(option("notes") ? { notes: option("notes") } : {}),
  released: new Date().toISOString().slice(0, 10),
};

const listPath = option("list");
const list = listPath && fs.existsSync(listPath) ? JSON.parse(fs.readFileSync(listPath, "utf8")) : { format: 1, basemaps: [] };
let map = list.basemaps.find((candidate) => candidate.id === id);
if (!map) {
  map = { id, name: option("name") || id, versions: [] };
  list.basemaps.push(map);
}
for (const key of ["name", "author", "license"]) if (option(key)) map[key] = option(key);
if (map.versions.some((existing) => existing.version === version)) {
  fail(`${id} already has a version ${version}. A changed file is a new version: use --version ${Math.max(...map.versions.map((v) => v.version)) + 1}.`);
}
map.versions.push(entry);
map.versions.sort((a, b) => a.version - b.version);

// The game must accept what was written, or the map is silently left out.
const accepted = parseOfficialCatalog(list, { cap: CAP }).basemaps.find((candidate) => candidate.id === id);
if (!accepted?.versions.some((v) => v.version === version)) fail("The game would leave this entry out of the list; nothing was written.");

console.log(`Checked: raster ${info.tileType} tiles, zooms ${info.minzoom}–${info.maxzoom}, ${Math.round(size / 1048576)} MB.`);
console.log(JSON.stringify(entry, null, 2));
if (listPath) {
  fs.writeFileSync(listPath, `${JSON.stringify(list, null, 2)}\n`);
  console.log(`\nWritten to ${listPath}.`);
}
console.log(`\nNext: on GitHub, make a release with the tag "${tag}", attach "${path.basename(file)}"${option("preview") ? ` and "${option("preview")}"` : ""} under exactly those names, publish it, then commit basemaps.json.`);
