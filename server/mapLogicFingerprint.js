/*! Open Historia — a scenario's map, by what it is © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The checksum a shared game's host states in its lobby, which each guest's copy
// of the scenario is checked against before it takes a country
// (src/multiplayer/client/standIn.js). It is computed from the map as the game
// reads it, never from bytes. The desktop keeps a map as files and the website
// and the Android app as records in IndexedDB, and the two never hold the same
// bytes: a checksum of the desktop's files could not be matched by any website or
// Android guest, whose build had no way to compute one either, so every such
// guest was told its copy of the host's map differs (the gap audit of
// 2026-11-18).
//
// What makes two copies one world: the same regions, each by its id (the rule
// both stores share, server/regionDelta.js), with its name and its starting
// owner; the same cities, by name and place to a hundredth of a degree; the same
// background and own basemaps; the same own tiles, by size. Not how finely a
// border is drawn: a build that ships a lighter outline of the same regions draws
// the same world. A region split in two, renamed or given to another owner is a
// different one, which is what this is for.
//
// Shared by the desktop store (server/libraryStore.js scenarioMapFingerprint) and
// the website's (src/runtime/web/libraryStore.js), so the two cannot drift. Pure.
import { sha256 } from "@noble/hashes/sha2.js";
import { regionDeltaKey } from "./regionDelta.js";

// The scenario's own tiles, by the keys both stores keep them under.
export const FINGERPRINT_TILE_KEYS = Object.freeze(["cities", "countries", "regions"]);

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const featuresOf = (collection) => (Array.isArray(collection?.features) ? collection.features : []);
const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const digest = (value) => toHex(sha256(new TextEncoder().encode(value)));
const hundredth = (value) => (Number.isFinite(Number(value)) ? (Math.round(Number(value) * 100) / 100).toFixed(2) : "-");

// JSON with every object's keys in order: the same value, written the same way
// wherever it was stored.
export const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : canonicalJson(entry))).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

const regionLines = (collection) => featuresOf(collection)
  .map((feature) => [regionDeltaKey(feature) ?? "", text(feature?.properties?.name), text(feature?.properties?.owner)].join("\t"))
  .sort();
const cityLines = (collection) => featuresOf(collection)
  .map((feature) => {
    const [lng, lat] = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    return [text(feature?.properties?.name), hundredth(lng), hundredth(lat)].join("\t");
  })
  .sort();

// A part a store holds nothing in. The website answers a scenario with no such
// file with an empty FeatureCollection, the desktop with no file: both are none.
const isNone = (value) => {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value !== "object") return false;
  const keys = Object.keys(value).filter((key) => !(key === "type" && value.type === "FeatureCollection"));
  if (!keys.length) return true;
  return keys.length === 1 && keys[0] === "features" && Array.isArray(value.features) && value.features.length === 0;
};

// `parts`: the scenario's map as its store serves it. Each geojson part is the
// parsed document, or null when the scenario has none; `tiles` the size in bytes
// of each own tile set it has ({ regions: 1234 }), a missing one none.
export const mapLogicFingerprint = ({ regions = null, cities = null, background = null, ownBasemaps = null, tiles = {} } = {}) => {
  const lines = [
    `regions:${isNone(regions) ? "-" : digest(regionLines(regions).join("\n"))}`,
    `cities:${isNone(cities) ? "-" : digest(cityLines(cities).join("\n"))}`,
    `background:${isNone(background) ? "-" : digest(canonicalJson(background))}`,
    `ownBasemaps:${isNone(ownBasemaps) ? "-" : digest(canonicalJson(ownBasemaps))}`,
    ...FINGERPRINT_TILE_KEYS.map((key) => `tiles.${key}:${Number.isFinite(Number(tiles?.[key])) && Number(tiles[key]) > 0 ? Number(tiles[key]) : "-"}`),
  ];
  return digest(lines.join("\n"));
};
