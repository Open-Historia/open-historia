/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Import cities / points of interest as editable point features. The full set
// (~70k, every city the original app shipped) is pre-extracted to
// public/assets/cities-seed.json by scripts/extract-cities.mjs.

import { newId } from "./useMapDocument.js";

// Web build: seed hosted on the Worker /content proxy (VITE_OH_PMTILES_URL);
// local/desktop leaves it unset → same-origin /assets. On Pages /assets/*.json
// would 200-with-SPA-HTML (the seed isn't hosted there).
const CONTENT_BASE = (import.meta.env?.VITE_OH_PMTILES_URL || "/assets").replace(/\/$/, "");
const SEED_URL = `${CONTENT_BASE}/cities-seed.json`;
let _cache = null;
let _loading = null;

// Only a seed that arrived is kept. A failure (offline for a moment, a proxy
// hiccup, an HTML page served with 200) used to be cached as an empty list, so
// the imports added nothing and the search found nothing until a reload; now it
// throws, and the next call tries again. Callers that load at once share one
// download.
const loadSeed = () => {
  if (_cache) return Promise.resolve(_cache);
  if (!_loading) {
    _loading = (async () => {
      const r = await fetch(SEED_URL);
      if (!r.ok) throw new Error(`city seed: HTTP ${r.status}`);
      const seed = await r.json();
      if (!Array.isArray(seed) || !seed.length) throw new Error("city seed: not a list of cities");
      _cache = seed;
      return seed;
    })().finally(() => { _loading = null; });
  }
  return _loading;
};

const toFeature = (c) => ({
  id: newId("feat"),
  name: c.name,
  type: "Coordinate",
  symbol: "square",
  coord: c.coord,
  country: c.country || "",
  owner: null,
  regionId: null,
  population: c.population || 0,
  tags: c.tags || ["city"],
});

// Roughly how many bytes a list of features adds to the document, its autosave
// and the scenario's cities.geojson, from an even sample of them: the whole
// seed is ~70k features, too many to stringify just to ask.
export const estimateJsonBytes = (list, samples = 200) => {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return 0;
  const step = Math.max(1, Math.floor(items.length / samples));
  let bytes = 0;
  let counted = 0;
  for (let i = 0; i < items.length; i += step) {
    bytes += JSON.stringify(items[i]).length + 1;
    counted += 1;
  }
  return Math.round((bytes / counted) * items.length);
};

// Every city / POI from the original dataset. Both imports throw when the seed
// cannot be downloaded.
export const importAllCities = async () => (await loadSeed()).map(toFeature);

// Capitals + large cities only.
export const importMajorCities = async ({ minPopulation = 500000 } = {}) =>
  (await loadSeed())
    .filter((c) => c.capital || (c.population || 0) >= minPopulation)
    .map(toFeature);

// Name search over the modern world place index (for the editor search bar).
// Prefix matches rank above substring matches; within each, capitals and larger
// cities first. Entries without coordinates can't be located, so they're skipped.
// A seed that cannot be downloaded finds nothing this time and is asked for
// again on the next search.
export const searchSeedCities = async (query, limit = 8) => {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  let seed;
  try {
    seed = await loadSeed();
  } catch (e) {
    console.warn("[editor] city seed load failed (run scripts/extract-cities.mjs):", e);
    return [];
  }
  const starts = [];
  const contains = [];
  for (const c of seed) {
    if (!Array.isArray(c.coord) || c.coord[0] == null || c.coord[1] == null) continue;
    const name = String(c.name || "").toLowerCase();
    if (!name) continue;
    if (name.startsWith(q)) starts.push(c);
    else if (name.includes(q)) contains.push(c);
  }
  const rank = (a, b) =>
    (b.capital === true) - (a.capital === true) || (b.population || 0) - (a.population || 0);
  starts.sort(rank);
  contains.sort(rank);
  return [...starts, ...contains].slice(0, limit);
};
