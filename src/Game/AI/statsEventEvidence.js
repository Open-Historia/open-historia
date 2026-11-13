/*! Open Historia — the events a country's Stats are shown © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Which events a country's Stats sheet reads as evidence and counts as
// accounted for: the economic evidence and the population calibration canon
// (gameplay.js and their worker copies in countryStatsWorkerKernel.js), and a
// scenario's own stats (customStatContinuity.js).
//
// An event is about a country when its structure says so: a polity its
// operations change or move, a combatant, a country among its places, a
// country a chat it opens is with, and, for the player's own country, its
// playerRelated. What kind of event it is comes from its category tags
// (runtime/eventTags.js). Neither is read from its words. An English list of
// economic and demographic words, and a country's name found in the prose by
// five-letter prefixes ("Germa" for German and Germany), decided both before:
// in a game played in another language they chose nothing, and in English they
// took "trade winds" for trade and "Nigeria" for "Niger".
//
// Import-free, so the Stats worker runs it.

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// An event with one of these tags is economic evidence for a country it is
// about: the economy itself, a disaster's damage, a war's cost.
export const STATS_ECONOMIC_TAGS = Object.freeze(["Economy", "Disaster", "Military"]);
// And demographic canon for that country's population calibration: a war's
// dead and displaced, a famine's or an epidemic's.
export const STATS_DEMOGRAPHIC_TAGS = Object.freeze(["Military", "Disaster"]);

// Whether an event carries one of `tags`, matched exactly (case aside).
export const eventHasAnyTag = (event, tags) => {
  const wanted = new Set(list(tags).map((tag) => clean(tag).toLowerCase()));
  return list(event?.tags).some((tag) => wanted.has(clean(tag).toLowerCase()));
};

// Every polity an event names in its structure, as written there.
export const eventPolityNames = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  const names = [];
  const push = (...values) => {
    for (const value of values) {
      const name = clean(value);
      if (name) names.push(name);
    }
  };
  for (const change of list(impacts.polityChanges)) push(change?.code, change?.name, change?.country);
  for (const transfer of list(impacts.regionTransfers)) push(transfer?.fromCode, transfer?.toCode);
  for (const op of list(impacts.regionControlOps)) push(op?.fromCode, op?.toCode, op?.actorCode, op?.claimantCode);
  for (const claim of list(impacts.regionClaims)) push(claim?.claimantCode);
  for (const op of list(impacts.politicalActorOps)) push(op?.polityKey || op?.polity || op?.country);
  for (const op of list(impacts.unitOps)) push(op?.unit?.ownerCode, op?.ownerCode);
  for (const op of list(impacts.markerOps)) push(op?.marker?.ownerCode, op?.ownerCode);
  for (const chat of list(impacts.createdChats)) {
    for (const country of list(chat?.countries)) push(typeof country === "string" ? country : country?.name || country?.code);
  }
  for (const name of list(event?.combatants)) push(typeof name === "string" ? name : name?.name);
  for (const place of list(event?.places)) {
    if (clean(place?.kind).toLowerCase() === "country") push(place?.name);
  }
  return names;
};

// Whether an event is about the country `isTarget` recognises by name (an
// exact identity check: gameplay.js canonicalStatsPolity). `playerIsTarget`:
// that country is the player's own, whose events say so in playerRelated.
export const eventConcernsTarget = (event, isTarget, { playerIsTarget = false } = {}) =>
  (playerIsTarget && event?.playerRelated === true)
  || eventPolityNames(event).some((name) => isTarget(name));
