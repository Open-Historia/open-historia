/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Import cities / points of interest as editable point features. The full set
// (~70k, every city the original app shipped) is pre-extracted to
// public/assets/cities-seed.json by scripts/extract-cities.mjs.

import { newId } from "./useMapDocument.js";

// Web build: seed hosted on the Worker /content proxy (VITE_OH_PMTILES_URL);
// local/desktop leaves it unset → same-origin /assets. On Pages /assets/*.json
// would 200-with-SPA-HTML (the seed isn't hosted there).
const CONTENT_BASE = (import.meta.env.VITE_OH_PMTILES_URL || "/assets").replace(/\/$/, "");
const SEED_URL = `${CONTENT_BASE}/cities-seed.json`;
let _cache = null;

const loadSeed = async () => {
  if (_cache) return _cache;
  try {
    const r = await fetch(SEED_URL);
    _cache = r.ok ? await r.json() : [];
  } catch (e) {
    console.warn("[editor] city seed load failed (run scripts/extract-cities.mjs):", e);
    _cache = [];
  }
  return _cache;
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

// How many cities are available to import (for the button label).
export const cityCount = async () => (await loadSeed()).length;

// Every city / POI from the original dataset.
export const importAllCities = async () => (await loadSeed()).map(toFeature);

// Capitals + large cities only.
export const importMajorCities = async ({ minPopulation = 500000 } = {}) =>
  (await loadSeed())
    .filter((c) => c.capital || (c.population || 0) >= minPopulation)
    .map(toFeature);

// Name search over the modern world place index (for the editor search bar).
// Prefix matches rank above substring matches; within each, capitals and larger
// cities first. Entries without coordinates can't be located, so they're skipped.
export const searchSeedCities = async (query, limit = 8) => {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const seed = await loadSeed();
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
