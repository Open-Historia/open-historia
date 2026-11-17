/*! Open Historia — which regions' fill colour must be written © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The regions' fills carry their colour as feature-state (Nations.jsx). Every
// change of colour, a turn's new owners or the diplomatic map's new view or
// focus, is written as the difference between the colours wanted and those
// already drawn: a region whose colour is the same is never written again, so
// a focus that changes forty countries' colours writes their regions alone, not
// the map's four thousand. A held region keeps its old colour until its
// hand-over sweep lets go (vnext/ownershipPresentationHolds.js).
//
//   next     Map regionId -> colour wanted
//   applied  Map regionId -> colour drawn
//   held     Set of region ids not to touch now
// Returns [{ kind: "set", regionId, fillColor } | { kind: "remove", regionId }].
export const fillStateOperations = (next, applied, held = new Set()) => {
  const operations = [];
  for (const [regionId, fillColor] of next) {
    if (held.has(regionId) || applied.get(regionId) === fillColor) continue;
    operations.push({ kind: "set", regionId, fillColor });
  }
  for (const regionId of applied.keys()) {
    if (held.has(regionId) || next.has(regionId)) continue;
    operations.push({ kind: "remove", regionId });
  }
  return operations;
};
