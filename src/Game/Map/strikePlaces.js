/*! Open Historia — where a strike's places are, as the map knows them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A strike keeps its two places by name, and by coordinates where the turn
// could find them (runtime/strikes.js). What it could not find the map looks
// for when the strike is played, among the places it already knows by name
// for Search (runtime/placeSearch.js): the scenario's cities, its structures,
// its countries at the place their names are drawn, its groups and the
// formations on the map. A strike nobody gave a launching place sets off from
// its owner's country.
//
// Pure: the entries are handed in.

import { normalizePlaceText } from "../../runtime/placeSearch.js";
import { parsePlace } from "../../runtime/strikes.js";

const SOURCE_OF_KIND = { city: "city", country: "polity", structure: "marker", unit: "unit", group: "group" };

// The place a name means, as [lng, lat], or null. `value` may carry its kind
// ("city: Kyiv"); the entry of that kind is taken before any other of the name.
export const findPlaceEntry = (entries, value) => {
  const { kind, name } = parsePlace(value);
  const needle = normalizePlaceText(name);
  if (!needle) return null;
  const called = (Array.isArray(entries) ? entries : []).filter((entry) => Array.isArray(entry?.aliases) && entry.aliases.includes(needle) && Number.isFinite(entry.lng) && Number.isFinite(entry.lat));
  if (called.length === 0) return null;
  const wanted = SOURCE_OF_KIND[kind];
  const best = called.find((entry) => entry.source === wanted) ?? called.slice().sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0];
  return [best.lng, best.lat];
};

// A strike's two ends, as { from, to } with each [lng, lat] or null.
export const strikeEnds = (strike, entries) => {
  const placed = (place) => (place && Number.isFinite(place.lng) && Number.isFinite(place.lat) ? [place.lng, place.lat] : null);
  const to = placed(strike?.to) ?? findPlaceEntry(entries, strike?.to?.name);
  const from = placed(strike?.from)
    ?? findPlaceEntry(entries, strike?.from?.name)
    // Launched from nowhere that is known: from its owner's own country.
    ?? findPlaceEntry(entries, `country: ${strike?.owner ?? ""}`)
    ?? findPlaceEntry(entries, strike?.owner);
  return { from, to };
};
