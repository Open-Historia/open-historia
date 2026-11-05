/*! Open Historia — the map's own claims, seen by everything © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A dispute can be declared in two places: a region's `claimants` in the map
// file (where the Scenario Workshop draws them) and a row in
// world.regionClaimants (where the AI, the cheats and a scenario seed write
// them). The map has always read both — a world row wins, even one that ended
// the dispute (world.settledRegionClaims), and a region the world has no say on
// shows the map file's own list (useWorldState.js withSettledClaims, the
// boundary worker's deriveDisputedData). Everything else read only the world:
// a dispute drawn in the Workshop was striped on the map while the AI, the
// region card and the Region Inspector never heard of it, and the first claim
// the AI raised on such a region replaced the drawn claimants instead of
// joining them.
//
// withMapClaims gives a world the same view the map has, by adding a row for
// every region the map file disputes and the world does not mention. Nothing
// the world says is changed. It runs where the world is read, from the region
// catalog the map has already parsed (assets.js getPrimedScenarioRegionCatalog)
// — no extra read, nothing when no map is loaded — and a writer that saves
// what it read makes the rows the world's own, which is the same dispute.
//
// Import-free, so node tests and the worker-side code can use it.

const MAX_CLAIMANTS = 4; // gameState.js caps a world row at four

// The catalog entries that carry claimants, as [id, names] — worked out once
// per catalog (the built-in map disputes 109 of its 4,848 regions).
let lastEntries = null;
let lastBaked = [];
const bakedClaims = (entries) => {
  if (entries === lastEntries) return lastBaked;
  const baked = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = entry?.id != null ? String(entry.id) : "";
    if (!id || !Array.isArray(entry?.claimants)) continue;
    const names = [...new Set(entry.claimants.map((value) => String(value ?? "").trim()).filter(Boolean))];
    if (names.length) baked.push([id, names.slice(0, MAX_CLAIMANTS)]);
  }
  lastEntries = entries;
  lastBaked = baked;
  return baked;
};

// The world with a regionClaimants row for every region the map file disputes
// and the world does not mention (no row, not settled). The same object back
// when there is nothing to add.
export const withMapClaims = (world, entries) => {
  if (!world || typeof world !== "object") return world;
  const baked = bakedClaims(entries);
  if (!baked.length) return world;
  const recorded = world.regionClaimants && typeof world.regionClaimants === "object" && !Array.isArray(world.regionClaimants)
    ? world.regionClaimants
    : {};
  const settled = new Set((Array.isArray(world.settledRegionClaims) ? world.settledRegionClaims : []).map(String));
  let merged = null;
  for (const [id, names] of baked) {
    if (Object.prototype.hasOwnProperty.call(recorded, id) || settled.has(id)) continue;
    if (!merged) merged = { ...recorded };
    merged[id] = [...names];
  }
  return merged ? { ...world, regionClaimants: merged } : world;
};
