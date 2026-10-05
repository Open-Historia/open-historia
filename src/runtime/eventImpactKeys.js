/*! Open Historia — the impact arrays an event can carry © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every impact array an event can carry that changes canonical state (the
// arrays normalizeEventImpacts in gameState.js keeps), in the order a reader
// cares about. One list, so the Event Editor's "State-linked" badge, the GM
// console's checks and counts, the turn's application receipt and the
// timeline curator cannot disagree about what an event did — they used to
// keep partial lists of their own, and an event that founded a group or
// changed a government showed no badge and could be deleted as though it had
// done nothing. Import-free, so node --test and every layer can load it.

export const EVENT_IMPACT_KEYS = Object.freeze([
  "regionTransfers",
  "regionControlOps",
  "regionClaims",
  "groupOps",
  "polityChanges",
  "politicalActorOps",
  "institutionLifecycleOps",
  "unitOps",
  "markerOps",
  "spyOps",
  "projectOps",
  "createdChats",
  "reports",
  "actionIds",
]);

// [key, count] for each impact array the event actually carries, in
// EVENT_IMPACT_KEYS order.
export const eventImpactCounts = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  return EVENT_IMPACT_KEYS
    .map((key) => [key, Array.isArray(impacts[key]) ? impacts[key].length : 0])
    .filter(([, count]) => count > 0);
};

export const eventHasImpacts = (event, keys = EVENT_IMPACT_KEYS) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  return keys.some((key) => Array.isArray(impacts[key]) && impacts[key].length > 0);
};
