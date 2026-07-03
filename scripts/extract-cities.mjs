/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Offline extractor for the FULL city / point-of-interest set from the game's
// cities.pmtiles (the same data the original app renders). cities.pmtiles is
// zoom 0-3; we sweep every tile across those levels and de-duplicate by name +
// rounded coordinate, writing a single asset the editor can import wholesale:
//
//     public/assets/cities-seed.json
//
// Run:  node scripts/extract-cities.mjs

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { PMTiles } from "pmtiles";
import * as vtmod from "@mapbox/vector-tile";
import * as pbfmod from "pbf";

const VectorTile = vtmod.VectorTile ?? vtmod.default?.VectorTile;
const Pbf = pbfmod.default ?? pbfmod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CITIES_PMTILES = path.join(PROJECT_ROOT, "public", "assets", "cities.pmtiles");
const OUT_PATH = path.join(PROJECT_ROOT, "public", "assets", "cities-seed.json");

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

const round5 = (n) => Math.round(n * 1e5) / 1e5;

const tagsFor = (isCapital, pop) => {
  if (isCapital) return ["city", "capital"];
  if (pop >= 1_000_000) return ["city", "large_city"];
  if (pop >= 100_000) return ["city"];
  return ["city", "small_city"];
};

const main = async () => {
  const buf = readFileSync(CITIES_PMTILES);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const archive = new PMTiles(new MemorySource(ab));
  const header = await archive.getHeader();
  const maxZoom = header.maxZoom ?? 3;
  console.log(`[extract-cities] cities.pmtiles zoom ${header.minZoom}-${maxZoom}; sweeping...`);

  const seen = new Map();
  let tiles = 0;
  for (let z = 0; z <= maxZoom; z += 1) {
    const side = 2 ** z;
    for (let x = 0; x < side; x += 1) {
      for (let y = 0; y < side; y += 1) {
        const tile = await archive.getZxy(z, x, y);
        if (!tile?.data) continue;
        tiles += 1;
        const vt = new VectorTile(new Pbf(new Uint8Array(tile.data)));
        const layer = vt.layers.cities || vt.layers[Object.keys(vt.layers)[0]];
        if (!layer) continue;
        for (let i = 0; i < layer.length; i += 1) {
          const feat = layer.feature(i);
          const p = feat.properties || {};
          const name = String(p.city || p.name || p.NAME || "").trim();
          if (!name) continue;
          const gj = feat.toGeoJSON(x, y, z);
          const coord = gj.geometry?.coordinates;
          if (!Array.isArray(coord) || coord.length < 2) continue;
          const lng = round5(coord[0]);
          const lat = round5(coord[1]);
          const key = `${name}|${lng},${lat}`;
          if (seen.has(key)) continue;
          const isCapital = String(p.capital || "").toLowerCase() === "primary" || p.capital === true;
          const pop = Number(p.population || p.pop_max || 0) || 0;
          seen.set(key, { name, coord: [lng, lat], population: pop, capital: isCapital, tags: tagsFor(isCapital, pop) });
        }
      }
    }
    process.stdout.write(`\r[extract-cities] through z${z}: ${tiles} tiles, ${seen.size} unique cities`);
  }
  process.stdout.write("\n");

  const list = Array.from(seen.values());
  writeFileSync(OUT_PATH, JSON.stringify(list));
  const bytes = readFileSync(OUT_PATH).byteLength;
  console.log(
    `[extract-cities] wrote ${path.relative(PROJECT_ROOT, OUT_PATH)} · ` +
      `${list.length} cities · ${(bytes / 1e3).toFixed(0)} KB`,
  );
};

main().catch((e) => {
  console.error("[extract-cities] FAILED:", e);
  process.exit(1);
});
