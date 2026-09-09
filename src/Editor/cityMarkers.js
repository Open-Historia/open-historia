/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Turn the city rows the Province Map Importer collects from an imported GeoJSON
// (collectImportedCityPoints in ProvinceImportPanel.jsx) into the editor's point
// features, and merge them into a document's feature list. Import-free so the
// merge can be tested in node; useMapDocument's importCityMarkers is the thin
// state wrapper around it.
//
// A city feature is the shape every other creation site in the editor uses
// (MapEditor.jsx onFeatureCreate / onAddCity, the scenario hydration):
//   { id, name, type: "Coordinate", symbol, coord: [lon, lat], country, owner,
//     regionId, population, tags: ["city", "capital"?], tier? }
// plus the optional label fields the importer's own backup round-trips
// (scale, labelScale, labelPlacement). buildCitiesForGame (exportPreset.js) reads
// coord, name, population, tags and tier from it, so an imported city ends up in
// the scenario's cities.geojson exactly like a hand-placed one.

const normalizeTags = (tags) => {
  const list = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split("|") : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
};

const finiteOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const isCityFeature = (feature) => {
  const tags = Array.isArray(feature?.tags) ? feature.tags.map((t) => String(t).toLowerCase()) : [];
  return tags.includes("city") || tags.includes("capital");
};

// One importer row -> one editor feature. Returns null for a row that cannot be
// placed (no name, or no usable coordinate).
export const cityRowToFeature = (row, id) => {
  if (!row || typeof row !== "object") return null;
  const name = String(row.name ?? "").trim();
  const coord = Array.isArray(row.coord) ? row.coord.slice(0, 2).map(Number) : null;
  if (!name || !coord || coord.length !== 2 || !coord.every(Number.isFinite)) return null;
  if (coord[0] < -180 || coord[0] > 180 || coord[1] < -90 || coord[1] > 90) return null;

  const tags = normalizeTags(row.tags);
  const lower = tags.map((t) => t.toLowerCase());
  if (!lower.includes("city")) tags.unshift("city");
  const tier = Math.round(finiteOr(row.tier, 0));
  const population = Math.max(0, Math.round(finiteOr(row.population, 0)));
  const scale = finiteOr(row.scale, 0);
  const labelScale = finiteOr(row.labelScale, 0);
  const labelPlacement = row.labelPlacement != null ? String(row.labelPlacement) : "";

  return {
    id,
    name,
    type: "Coordinate",
    symbol: String(row.symbol ?? "").trim() || "square",
    coord,
    country: String(row.country ?? "").trim(),
    owner: row.owner ? String(row.owner) : null,
    regionId: row.regionId ? String(row.regionId) : row.sourceRegionId ? String(row.sourceRegionId) : null,
    population,
    tags,
    ...(tier >= 1 && tier <= 3 ? { tier } : {}),
    ...(scale > 0 ? { scale } : {}),
    ...(labelScale > 0 ? { labelScale } : {}),
    ...(labelPlacement ? { labelPlacement } : {}),
  };
};

// Two markers are "the same city" when the names match (case-insensitive) and
// they sit within this many degrees of each other — a re-import of the same
// export lands on the same coordinate, a hand-nudged marker a hair away.
const SAME_CITY_TOLERANCE_DEG = 0.05;

const sameCity = (feature, incoming) =>
  String(feature.name ?? "").trim().toLowerCase() === incoming.name.toLowerCase() &&
  Array.isArray(feature.coord) &&
  Math.abs(Number(feature.coord[0]) - incoming.coord[0]) <= SAME_CITY_TOLERANCE_DEG &&
  Math.abs(Number(feature.coord[1]) - incoming.coord[1]) <= SAME_CITY_TOLERANCE_DEG;

// Merge importer rows into a feature list.
//   replaceExisting: every current city marker goes; the rows become the cities.
//                    Point features that are not cities are kept either way.
//   otherwise:       a row matching an existing city (name + place) updates it in
//                    place and keeps its id; anything else is appended.
// `nextId` mints ids for new features (useMapDocument's newId("feat")).
// Returns the new list and a summary the importer's status line reports.
export const mergeCityMarkers = (features, rows, { replaceExisting = false, nextId } = {}) => {
  const mint = typeof nextId === "function" ? nextId : (() => { let n = 0; return () => `feat_import_${(n += 1)}`; })();
  const current = Array.isArray(features) ? features : [];
  const incoming = [];
  let skipped = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const feature = cityRowToFeature(row, null);
    if (feature) incoming.push(feature);
    else skipped += 1;
  }

  if (replaceExisting) {
    const kept = current.filter((feature) => !isCityFeature(feature));
    const replaced = current.length - kept.length;
    const added = incoming.map((feature) => ({ ...feature, id: mint() }));
    return {
      features: [...kept, ...added],
      count: added.length,
      created: added.length,
      updated: 0,
      replaced,
      skipped,
    };
  }

  const next = current.slice();
  let updated = 0;
  let created = 0;
  for (const feature of incoming) {
    const index = next.findIndex((existing) => isCityFeature(existing) && sameCity(existing, feature));
    if (index >= 0) {
      next[index] = { ...next[index], ...feature, id: next[index].id };
      updated += 1;
    } else {
      next.push({ ...feature, id: mint() });
      created += 1;
    }
  }
  return { features: next, count: created + updated, created, updated, replaced: 0, skipped };
};
