/*!
 * Pax Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Import cities / points of interest as editable point features. The full set
// (~70k, every city the original app shipped) is pre-extracted to
// public/assets/cities-seed.json by scripts/extract-cities.mjs.

import { newId } from "./useMapDocument.js";

const SEED_URL = "/assets/cities-seed.json";
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
