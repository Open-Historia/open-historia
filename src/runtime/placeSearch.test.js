/*! Open Historia — the map search finds what this world named, in the script it was named in: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/placeSearch.test.js
//
// The search box finds the places a world made for itself: the structures the
// AI built, the cities it renamed, a scenario's own countries. A game played in
// Russian names them in Russian, and its player types in Russian. A name and a
// query were both folded to a-z0-9, so both were empty: the query searched for
// nothing, and nothing so named could have been found.

import test from "node:test";
import assert from "node:assert/strict";

import { buildLocalPlaceEntries, normalizePlaceText, scorePlaceName, searchLocalPlaces } from "./placeSearch.js";

const entries = buildLocalPlaceEntries({
  markers: [
    { id: "m1", name: "Береговая батарея «Утёс»", kind: "fortification", ownerCode: "Russian Federation", lng: 33.4, lat: 44.6 },
    { id: "m2", name: "Верфь Левиафан", kind: "shipyard", ownerCode: "Russian Federation", lng: 33.5, lat: 44.62 },
    { id: "m3", name: "Fort Ross", kind: "fortification", ownerCode: "United States", lng: -123.2, lat: 38.5 },
    { id: "m4", name: "旅顺口要塞", kind: "fortification", ownerCode: "China", lng: 121.2, lat: 38.8 },
  ],
  cities: [
    { name: "Saint Petersburg", lng: 30.3, lat: 59.9, tier: 3, capital: false, population: 5_000_000 },
    { name: "Volgograd", lng: 44.5, lat: 48.7, tier: 2, capital: false, population: 1_000_000 },
  ],
  polities: [{ owner: "Новороссия", lng: 37.8, lat: 48 }],
  cityRenames: { "saint petersburg": "Петроград", volgograd: "Сталинград" },
});
const found = (query, limit = 4) => searchLocalPlaces(entries, query, limit).map((entry) => entry.name);

test("a query in Cyrillic finds the structures, cities and countries named in Cyrillic", () => {
  assert.deepEqual(found("батарея"), ["Береговая батарея «Утёс»"]);
  assert.deepEqual(found("ВЕРФЬ"), ["Верфь Левиафан"], "case folds in any script");
  assert.deepEqual(found("утес"), ["Береговая батарея «Утёс»"], "and so do accents: ё is е to a search");
  assert.deepEqual(found("Петроград"), ["Петроград"], "a city by the name it was given");
  assert.deepEqual(found("Сталин"), ["Сталинград"], "from the start of its name");
  assert.deepEqual(found("Новороссия"), ["Новороссия"]);
  assert.deepEqual(found("крепость"), [], "what nothing is called is not found");
});

test("and in Chinese", () => {
  assert.deepEqual(found("旅顺"), ["旅顺口要塞"]);
  assert.deepEqual(found("要塞"), ["旅顺口要塞"]);
  assert.deepEqual(found("东京"), []);
});

test("a query in Latin letters finds what it always found", () => {
  assert.deepEqual(found("fort"), ["Fort Ross"]);
  assert.deepEqual(found("saint pet"), ["Петроград"], "a renamed city still answers to the name the map knew");
  assert.deepEqual(found(""), []);
  assert.deepEqual(found("   "), []);
  assert.deepEqual(found("!!!"), [], "punctuation alone is still no query");
});

test("an exact name outranks a name that starts with it, in any script", () => {
  assert.ok(scorePlaceName("Сталинград", "сталинград") > scorePlaceName("Сталинградская область", "сталинград"));
  assert.ok(scorePlaceName("Сталинградская область", "сталинград") > scorePlaceName("Новый Сталинград", "сталинград"));
  assert.equal(scorePlaceName("Севастополь", "Мурманск"), 0);
  assert.equal(normalizePlaceText("  Санкт-Петербург! "), "санкт петербург");
});
