/*! Open Historia — a scenario's map, by its checksum © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a scenario's map is, as one checksum. A shared game's host states it in
// its lobby, and each guest's screen checks its own copy against it before it
// takes a country: two copies that differ draw two different worlds, and
// nothing used to say so. A region the host had split in two stayed one on the
// guest's copy, which went on showing its old owner for the whole game while the
// events said otherwise.
//
// The desktop's half: the files the game draws the map from (its regions,
// cities, background and own basemaps as the runtime serves them, the stock
// world's where it has none of its own), read and put through the one rule both
// stores share (server/mapLogicFingerprint.js), which the website's store applies
// to its own records. It used to be a checksum of the files' bytes, which no
// website or Android guest could ever match.
//
// A fingerprint is kept while every file's size and time stay the same, so a
// lobby asked again reads nothing; a file rewritten (its owners' schema, the
// first time it is served) is read again.
import fs from "node:fs";
import { FINGERPRINT_TILE_KEYS, mapLogicFingerprint } from "./mapLogicFingerprint.js";

const kept = new Map(); // stamps of every file -> fingerprint

const stampOf = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return "-";
  const stat = fs.statSync(filePath);
  return `${filePath}:${stat.size}:${stat.mtimeMs}`;
};
const readJson = (filePath) => (filePath && fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null);
const sizeOf = (filePath) => (filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);

// `files`: the path of each map document the runtime serves, or null when the
// scenario has none ({ regions, cities, background, ownBasemaps }); `tiles` the
// path of each own tile set by its key (FINGERPRINT_TILE_KEYS).
export const scenarioFilesFingerprint = ({ files = {}, tiles = {} } = {}) => {
  const paths = [files.regions, files.cities, files.background, files.ownBasemaps, ...FINGERPRINT_TILE_KEYS.map((key) => tiles[key])];
  const stamp = paths.map(stampOf).join("|");
  if (kept.has(stamp)) return kept.get(stamp);
  const fingerprint = mapLogicFingerprint({
    regions: readJson(files.regions),
    cities: readJson(files.cities),
    background: readJson(files.background),
    ownBasemaps: readJson(files.ownBasemaps),
    tiles: Object.fromEntries(FINGERPRINT_TILE_KEYS.map((key) => [key, sizeOf(tiles[key])])),
  });
  kept.set(stamp, fingerprint);
  return fingerprint;
};
