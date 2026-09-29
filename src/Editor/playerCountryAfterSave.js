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

import { renamePolityInWorld } from "../../server/polityRename.js";

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

// A Workshop rename re-keys the map and the document and keeps no old name
// (server/polityRename.js authoredRecord), so the scenario's player country and
// the world records keyed by name (tags, goals, relations, stats…) would still
// say the old one: the country then looked gone from the map and the start
// country fell back to the first owner. The save replays the Workshop's renames,
// in order, onto the scenario's own world and game before the map is written.
// Only the renames made are applied; the player country moves only when it is
// exactly the renamed key.
export const scenarioAfterWorkshopRenames = (world, game, renames) => {
  let nextWorld = world ?? {};
  let country = game?.country;
  for (const rename of Array.isArray(renames) ? renames : []) {
    const from = String(rename?.from ?? "").trim();
    const to = String(rename?.to ?? "").trim();
    if (!from || !to || from === to) continue;
    try {
      nextWorld = renamePolityInWorld(nextWorld, from, to).world;
    } catch (error) {
      // The old registry already holds the new name (a polity deleted in the
      // Workshop and its name reused): its records are left as they are.
      console.warn("[editor] could not carry a rename into the scenario's world:", error);
    }
    if (clean(country) === from) country = to;
  }
  return { world: nextWorld, game: country === game?.country ? game : { ...game, country } };
};
