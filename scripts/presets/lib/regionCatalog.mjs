/*! Open Historia — preset region catalog loader © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Region-catalog loader for the preset generator.
//
// Reuses the exact PMTiles decode path the runtime uses (src/runtime/assets.js:
// decodeVectorTile / loadRegionCatalog) so the codes we author against are
// guaranteed to match what the map renders. Reads tile 0/0/0 of regions.pmtiles
// (the overview tile the game itself treats as the complete region catalog).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { PMTiles } from "pmtiles";
import * as vtmod from "@mapbox/vector-tile";
import * as pbfmod from "pbf";

const VectorTile = vtmod.VectorTile ?? vtmod.default?.VectorTile;
const Pbf = pbfmod.default ?? pbfmod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/presets/lib -> project root is three levels up.
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
export const REGIONS_PMTILES = path.join(PROJECT_ROOT, "public", "assets", "regions.pmtiles");
export const COUNTRIES_PMTILES = path.join(PROJECT_ROOT, "public", "assets", "countries.pmtiles");

// Minimal in-memory PMTiles source for Node (mirrors the MemorySource pattern in assets.js).
class MemorySource {
  constructor(buffer) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }
  getKey() {
    return "mem";
  }
  async getBytes(offset, length) {
    const end = Math.min(this.bytes.byteLength, offset + length);
    return { data: this.bytes.slice(offset, end).buffer };
  }
}

const openArchive = (pmtilesPath) => {
  const buf = readFileSync(pmtilesPath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new PMTiles(new MemorySource(arrayBuffer));
};

const readLayerFeatures = async (pmtilesPath, layerName) => {
  const archive = openArchive(pmtilesPath);
  const tile = await archive.getZxy(0, 0, 0);
  if (!tile?.data) {
    throw new Error(`No tile 0/0/0 data in ${pmtilesPath}`);
  }
  const vt = new VectorTile(new Pbf(new Uint8Array(tile.data)));
  const layer = vt.layers[layerName];
  if (!layer) {
    throw new Error(`Layer "${layerName}" not found in ${pmtilesPath} (have: ${Object.keys(vt.layers).join(", ")})`);
  }
  const features = [];
  for (let i = 0; i < layer.length; i += 1) {
    features.push(layer.feature(i).properties);
  }
  return features;
};

// Returns [{ GID_0, GID_1, COUNTRY, NAME_1, HASC_1, ISO_1 }] for all admin-1 regions.
export const loadRegionCatalog = async (pmtilesPath = REGIONS_PMTILES) => {
  const features = await readLayerFeatures(pmtilesPath, "regions");
  return features.map((pr) => ({
    GID_0: pr.GID_0,
    GID_1: pr.GID_1,
    COUNTRY: pr.COUNTRY,
    NAME_1: pr.NAME_1,
    HASC_1: pr.HASC_1,
    ISO_1: pr.ISO_1,
  }));
};

// Returns [{ GID_0, COUNTRY }] for all countries.
export const loadCountryCatalog = async (pmtilesPath = COUNTRIES_PMTILES) => {
  const features = await readLayerFeatures(pmtilesPath, "countries");
  return features.map((pr) => ({ GID_0: pr.GID_0, COUNTRY: pr.COUNTRY }));
};

// Build a GID_0 -> [GID_1...] index from a region catalog.
export const buildCountryRegionIndex = (catalog) => {
  const index = new Map();
  for (const row of catalog) {
    if (!row.GID_0 || !row.GID_1) continue;
    if (!index.has(row.GID_0)) index.set(row.GID_0, []);
    index.get(row.GID_0).push(row.GID_1);
  }
  return index;
};
