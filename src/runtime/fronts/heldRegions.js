/*! Open Historia — battlefields and fronts: ground held is not ground disputed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A region one side of a battlefield has taken from the other is CONTROLLED by
// the side that took it, and that is all the map says of it: it is drawn as
// that country's, and its card says who controls it and whose it lawfully is.
// It is not drawn in the stripes of a disputed region. Those are for a claim
// (a declaration, a border two governments both draw as their own), and where
// the armies stand is told by the armies and the ground they have painted.
//
// The world keeps a dispute as a region's list of claimants
// (world.regionClaimants), and an occupation used to add the old holder to
// it. So the claimants a battlefield accounts for are taken out again here:
// for a region controlled by a member of one side of a battlefield and
// lawfully a member of the other's, every member of either side. A dispute
// with somebody else stands.
//
// Pure: the game applies it to the world when a turn's land war is written
// (gameState.js withoutBattlefieldDisputes), and the map to what it draws
// (Map/useWorldState.js), so a game saved before this is drawn right at once.

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// The regions whose list of claimants a battlefield changes, each with the
// list it is left with: a Map of regionId to names (empty when nobody is left).
//   battlefields   world.battlefields (a border only fortified in peace has
//                  taken nothing, and is passed over)
//   owners         who controls each region (world.regionOwnershipOverrides)
//   sovereigns     whose each region lawfully is, where that is somebody else
//                  (world.regionSovereigntyOverrides)
//   claimants      world.regionClaimants
export const battlefieldHeldClaimants = ({ battlefields, owners, sovereigns, claimants } = {}) => {
  const changed = new Map();
  const fields = (Array.isArray(battlefields) ? battlefields : [])
    .filter((record) => record && record.status !== "standing" && Array.isArray(record.sides) && record.sides.length === 2)
    .map((record) => record.sides.map((members) => new Set((Array.isArray(members) ? members : []).map(fold).filter(Boolean))));
  if (fields.length === 0 || !sovereigns || typeof sovereigns !== "object" || !claimants || typeof claimants !== "object") return changed;
  for (const [regionId, sovereign] of Object.entries(sovereigns)) {
    const names = claimants[regionId];
    if (!Array.isArray(names) || names.length === 0) continue;
    const controller = fold(owners?.[regionId]);
    const lawful = fold(sovereign);
    if (!controller || !lawful) continue;
    const field = fields.find(([a, b]) => (a.has(controller) && b.has(lawful)) || (b.has(controller) && a.has(lawful)));
    if (!field) continue;
    const kept = names.filter((name) => !field[0].has(fold(name)) && !field[1].has(fold(name)));
    if (kept.length !== names.length) changed.set(regionId, kept);
  }
  return changed;
};
