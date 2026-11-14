/*! Open Historia — who an event involves, by what it records © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The parties an event names in its structure, for everything that chooses
// what a prompt or a lookup shows by who an event was about: idle diplomacy's
// relevant governments (idlePoliticalDiplomacyContext.js), the groups a time
// skip describes in full and the events the storyline repair reads
// (gameplay.js), and recent_events' `about` (lookupTools.js).
//
// What it records, and nothing else:
// - who decided it: its actors, and its agency (its principal, whatever kind
//   of actor that is, and its sovereign rows);
// - who fought in it: its combatants, and both sides of the war its warId names;
// - the countries among its places, and the country a written city or region
//   was said to be in ("city: Kharkiv, country: Ukraine"; a found city or
//   region keeps no country);
// - every polity its operations change, move, claim, open a chat with or field
//   a formation or a structure for (nativeWorldIntegrity.js
//   eventStructuredPartyNames), and the groups its group operations act on.
//
// Never its words. Who an event was about was found by looking for names in
// its title and description: "Allemagne" was never "Germany", a Chinese name
// written against the next character was never found at all, and in English
// "IRA" was found in "Iran" and "Oman" in "Romania". What an event records says
// the same in every language (the owner, 2026-11-13: no keywording anywhere).
//
// Raw names, as written there, each once: a caller matches them exactly
// against its own vocabulary (an exact name, a code, an alias, a group's former
// name) and drops what it does not know.

import { readEventPlace } from "./eventPlaces.js";
import { eventStructuredPartyNames } from "./nativeWorldIntegrity.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const nameOf = (value) => clean(typeof value === "string" ? value : value?.name || value?.code);

// The countries an event's places name: a country it found on the map, or the
// country a place not yet found was written with (AI/eventPlaces.js
// readEventPlace, the game's own "kind: name, country: name" form).
export const eventPlaceCountries = (event) => {
  const out = [];
  for (const place of list(event?.places)) {
    if (typeof place === "string") {
      const read = readEventPlace(place);
      out.push(read?.kind === "country" ? read.name : read?.country);
    } else if (clean(place?.kind).toLowerCase() === "country") {
      out.push(place?.name);
    }
  }
  return out.map(clean).filter(Boolean);
};

// Every party `event` names in its structure (above). `wars`: the world's
// wars, for the sides of the one its warId names.
export const eventPartyNames = (event, { wars = [] } = {}) => {
  if (!event || typeof event !== "object" || Array.isArray(event)) return [];
  const impacts = event.impacts && typeof event.impacts === "object" ? event.impacts : {};
  const agency = event.agency && typeof event.agency === "object" ? event.agency : {};
  const warId = clean(event.warId);
  const war = warId ? list(wars).find((entry) => clean(entry?.id) === warId) : null;
  return [...new Set([
    ...eventStructuredPartyNames(event),
    nameOf(agency.principal),
    ...eventPlaceCountries(event),
    ...(war ? [...list(war.sideA), ...list(war.sideB)] : []).map(nameOf),
    ...list(impacts.groupOps).flatMap((op) => [nameOf(op?.name), nameOf(op?.newName)]),
    ...list(impacts.markerOps).flatMap((op) => [nameOf(op?.marker?.ownerCode), nameOf(op?.ownerCode)]),
  ].filter(Boolean))];
};
