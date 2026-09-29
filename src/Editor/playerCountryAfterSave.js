/*!
 * Open Historia Map Editor — the player country a Workshop save keeps
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A Workshop save writes the map into its scenario (libraryBar.jsx
// applyMapToScenario). The seed's own game.country is only the map's first
// owner: the Workshop has no player-country field and passes none to
// buildGameSeed (exportPreset.js). It used to replace the author's choice on
// every save, so a Japan scenario saved in the Workshop started as the United
// States. The scenario now keeps its country while the map still has it, by its
// exact name; the seed's pick is the start country only for a scenario with
// none, or one whose country is no longer on the map.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const playerCountryAfterSave = (currentCountry, seed) => {
  const current = clean(currentCountry);
  const fallback = clean(seed?.game?.country);
  if (!current) return fallback;
  const world = seed?.world ?? {};
  const onMap = new Set();
  for (const owner of Object.values(world.regionOwnershipOverrides ?? {})) onMap.add(clean(owner));
  for (const [key, record] of Object.entries(world.polityOverrides ?? {})) {
    onMap.add(clean(key));
    if (record && typeof record === "object") onMap.add(clean(record.name));
  }
  return onMap.has(current) ? current : (fallback || current);
};
