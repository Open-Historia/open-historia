/*!
 * Open Historia Map Editor — the world's disputes, opened in the Workshop
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A scenario's disputes live in two places: each region's `claimants` in the
// map file, and world.regionClaimants, where the built-in world, the AI and the
// cheats write them. The game reads them in that order of authority — a world
// row wins, an ended dispute (world.settledRegionClaims) has no claimants, and a
// region the world never mentions shows the map file's own list. The Workshop
// used to open the map file alone, so it showed disputes the game did not and
// missed the ones the game did; now it stamps the world's rows over the file's
// the same way, and what it saves (exportPreset.js) is the whole of them.
//
// Import-free: a feature is anything with getId() and set().

const cleanList = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map((entry) => String(entry ?? "").trim())
  .filter(Boolean))];

// (feature) => void, stamping the world's claims (`{ claimants, settled }`) over
// the feature's own. A no-op without overrides.
export const claimStamper = (overrides) => {
  const rows = overrides?.claimants && typeof overrides.claimants === "object" && !Array.isArray(overrides.claimants)
    ? overrides.claimants
    : null;
  const settled = new Set((Array.isArray(overrides?.settled) ? overrides.settled : []).map((id) => String(id)));
  if (!rows && !settled.size) return () => {};
  return (feature) => {
    const id = feature?.getId?.();
    if (id == null) return;
    const key = String(id);
    if (rows && Object.prototype.hasOwnProperty.call(rows, key)) {
      const list = cleanList(rows[key]);
      feature.set("claimants", list.length ? list : null);
    } else if (settled.has(key)) {
      feature.set("claimants", null);
    }
  };
};
