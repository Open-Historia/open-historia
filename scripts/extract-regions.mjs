/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Offline region-geometry extractor for the map editor.
//
// The game ships region geometry ONLY as MVT vector tiles (public/assets/
// regions.pmtiles). The zoom-0 overview tile is far too coarse to edit
// (a whole province is a ~6-vertex box). Real editable borders need a higher
// zoom, but at z>=5 a large region is split across several tiles, each holding
// a clipped fragment. This script stitches those fragments back into whole
// polygons by unioning them (polygon-clipping dissolves the artificial tile-seam
// edges) and writes a single GeoJSON the editor can load and edit directly:
//
//     public/assets/regions-seed.geojson
//
// Run:  node scripts/extract-regions.mjs [zoom]     (default zoom = 5)
//
// Reuses the exact Node PMTiles decode pattern from
// scripts/presets/lib/regionCatalog.mjs. Output is WGS84 lon/lat (EPSG:4326);
// the browser reprojects to the editor's Web-Mercator view on load. Coordinates
// are rounded to 5 decimals (~1 m) to keep the file small; identical shared
// vertices round identically, so neighbouring regions keep coincident borders.

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { PMTiles } from "pmtiles";
import * as vtmod from "@mapbox/vector-tile";
import * as pbfmod from "pbf";
import polygonClipping from "polygon-clipping";

const VectorTile = vtmod.VectorTile ?? vtmod.default?.VectorTile;
const Pbf = pbfmod.default ?? pbfmod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const REGIONS_PMTILES = path.join(PROJECT_ROOT, "public", "assets", "regions.pmtiles");
const OUT_PATH = path.join(PROJECT_ROOT, "public", "assets", "regions-seed.geojson");

const TARGET_ZOOM = Math.max(0, Number.parseInt(process.argv[2] ?? "5", 10) || 5);

// Minimal in-memory PMTiles source for Node (mirrors regionCatalog.mjs).
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

const round5 = (n) => Math.round(n * 1e5) / 1e5;
const clampLat = (lat) => Math.min(89.9999, Math.max(-89.9999, lat));

// Round a coordinate array to 5 decimals BEFORE unioning, so that seam vertices
// shared between adjacent tiles become bit-identical and polygon-clipping can
// dissolve the tile boundary cleanly instead of leaving thin sliver polygons.
const roundCoords = (node) =>
  typeof node[0] === "number" ? [round5(node[0]), round5(node[1])] : node.map(roundCoords);

// Recursively clamp latitude (data is already rounded) for output safety.
const cleanCoords = (node) => {
  if (typeof node[0] === "number") return [node[0], clampLat(node[1])];
  return node.map(cleanCoords);
};

// Shoelace area of a ring in deg^2 (used only to drop degenerate slivers).
const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
};
// ~5e-7 deg^2 ≈ 6000 m^2: trims thin tile-seam slivers and trivial rocks while
// keeping every real region/island (smallest inhabited islands are far larger).
const AREA_EPS = 5e-7;

// Drop <4-vertex rings and near-zero-area rings; drop a polygon if its exterior
// ring is a sliver. Returns a cleaned MultiPolygon (array of polygons) or [].
const cleanMultiPolygon = (mp) => {
  const out = [];
  for (const poly of mp) {
    if (!poly.length) continue;
    const exterior = poly[0];
    if (exterior.length < 4 || ringArea(exterior) < AREA_EPS) continue;
    const holes = poly.slice(1).filter((r) => r.length >= 4 && ringArea(r) >= AREA_EPS);
    out.push([exterior, ...holes]);
  }
  return out;
};

const main = async () => {
  console.log(`[extract-regions] reading ${path.relative(PROJECT_ROOT, REGIONS_PMTILES)}`);
  const archive = openArchive(REGIONS_PMTILES);
  const header = await archive.getHeader();
  const zoom = Math.min(TARGET_ZOOM, header.maxZoom ?? TARGET_ZOOM);
  const side = 2 ** zoom;
  console.log(
    `[extract-regions] archive zoom ${header.minZoom}-${header.maxZoom}; ` +
      `stitching at z${zoom} (${side}x${side} tile grid)`,
  );

  // gid1 -> { props, fragments: [GeoJSON coords ...] }
  const buckets = new Map();
  let tilesWithData = 0;
  let featureCount = 0;

  for (let x = 0; x < side; x += 1) {
    for (let y = 0; y < side; y += 1) {
      const tile = await archive.getZxy(zoom, x, y);
      if (!tile?.data) continue;
      tilesWithData += 1;
      const vt = new VectorTile(new Pbf(new Uint8Array(tile.data)));
      const layer = vt.layers.regions;
      if (!layer) continue;

      for (let i = 0; i < layer.length; i += 1) {
        const feature = layer.feature(i);
        const props = feature.properties ?? {};
        const gid1 = props.GID_1;
        if (!gid1) continue;

        const gj = feature.toGeoJSON(x, y, zoom);
        const geom = gj.geometry;
        if (!geom) continue;

        let bucket = buckets.get(gid1);
        if (!bucket) {
          bucket = {
            props: {
              id: String(gid1),
              gid0: props.GID_0 ?? "",
              name: props.NAME_1 ?? props.NAME ?? String(gid1),
              country: props.COUNTRY ?? props.Country ?? "",
            },
            fragments: [],
          };
          buckets.set(gid1, bucket);
        }
        // Normalise to polygon-clipping "Geom" (Polygon = [ring...]), rounding
        // first so shared tile-seam vertices align and dissolve on union.
        if (geom.type === "Polygon") {
          bucket.fragments.push(roundCoords(geom.coordinates));
        } else if (geom.type === "MultiPolygon") {
          for (const poly of geom.coordinates) bucket.fragments.push(roundCoords(poly));
        }
        featureCount += 1;
      }
    }
    if ((x + 1) % 4 === 0 || x === side - 1) {
      process.stdout.write(
        `\r[extract-regions] scanned column ${x + 1}/${side} · ` +
          `${tilesWithData} tiles · ${buckets.size} regions`,
      );
    }
  }
  process.stdout.write("\n");
  console.log(
    `[extract-regions] decoded ${featureCount} fragments across ${tilesWithData} tiles ` +
      `-> ${buckets.size} unique regions; unioning...`,
  );

  const features = [];
  let unioned = 0;
  let fallbacks = 0;
  for (const [gid1, bucket] of buckets) {
    let coords;
    let geomType;
    try {
      const raw = bucket.fragments.length === 1
        ? [bucket.fragments[0]] // single fragment: already a Polygon -> wrap as MultiPolygon
        : polygonClipping.union(bucket.fragments[0], ...bucket.fragments.slice(1));
      let result = cleanMultiPolygon(raw);
      if (result.length === 0) result = raw; // never lose a region to over-aggressive filtering
      if (result.length === 1) {
        geomType = "Polygon";
        coords = cleanCoords(result[0]);
      } else {
        geomType = "MultiPolygon";
        coords = cleanCoords(result);
      }
      unioned += 1;
    } catch (err) {
      // Robustness fallback: keep the raw fragments as a MultiPolygon (no dissolve)
      // so a region is never lost to a boolean-op failure.
      fallbacks += 1;
      geomType = "MultiPolygon";
      coords = cleanCoords(bucket.fragments);
    }
    features.push({
      type: "Feature",
      properties: bucket.props,
      geometry: { type: geomType, coordinates: coords },
    });
    if (unioned % 250 === 0) {
      process.stdout.write(`\r[extract-regions] unioned ${unioned}/${buckets.size}`);
    }
  }
  process.stdout.write("\n");

  const fc = { type: "FeatureCollection", features };
  writeFileSync(OUT_PATH, JSON.stringify(fc));
  const bytes = readFileSync(OUT_PATH).byteLength;
  console.log(
    `[extract-regions] wrote ${path.relative(PROJECT_ROOT, OUT_PATH)} · ` +
      `${features.length} regions · ${(bytes / 1e6).toFixed(1)} MB · ` +
      `${fallbacks} union fallbacks`,
  );
};

main().catch((err) => {
  console.error("[extract-regions] FAILED:", err);
  process.exit(1);
});
