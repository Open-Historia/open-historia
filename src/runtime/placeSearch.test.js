/*! Open Historia — the search bar's own places: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/placeSearch.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGroupIndex,
  buildLocalPlaceEntries,
  getWorldPlaceIndex,
  publishGroupIndex,
  searchLocalPlaces,
} from "./placeSearch.js";

const city = (name, lng, lat, extra = {}) => ({ name, lng, lat, tier: 2, capital: false, population: 100000, ...extra });
const names = (entries) => entries.map((entry) => entry.name);

test("a whole-name match outranks a prefix, which outranks a word inside the name", () => {
  const entries = buildLocalPlaceEntries({
    cities: [city("Port Vale", 0, 0), city("Valencia", 10, 10), city("Vale", 20, 20), city("Evaleen", 30, 30)],
  });
  assert.deepEqual(names(searchLocalPlaces(entries, "vale", 4)), ["Vale", "Valencia", "Port Vale", "Evaleen"]);
});

test("between equally good matches the more prominent place comes first", () => {
  const entries = buildLocalPlaceEntries({
    cities: [city("Springfield", 0, 0, { tier: 1, population: 900 }), city("Springfield", 40, 40, { capital: true, population: 2000000 })],
  });
  const [first] = searchLocalPlaces(entries, "springfield", 2);
  assert.equal(first.lng, 40, "the capital");
});

test("a place listed twice close together is shown once, and far apart twice", () => {
  const entries = buildLocalPlaceEntries({
    cities: [city("Brest", -4.49, 48.39), city("Brest", 23.7, 52.1)],
    markers: [{ id: "m1", name: "Brest", kind: "naval base", lng: -4.5, lat: 48.4 }],
  });
  const brests = searchLocalPlaces(entries, "brest", 5);
  assert.equal(brests.length, 2, "the structure in Brittany folds into the city, the one in Belarus stays");
  assert.equal(brests[0].source, "marker", "the structure is the one kept");
});

test("a renamed city is found by its new name and its old one", () => {
  const entries = buildLocalPlaceEntries({
    cities: [city("Leningrad", 30.3, 59.9)],
    cityRenames: { leningrad: "Saint Petersburg", stalingrad: "Volgograd" },
  });
  const [renamed] = searchLocalPlaces(entries, "leningrad", 1);
  assert.equal(renamed.name, "Saint Petersburg");
  assert.match(renamed.detail, /formerly Leningrad/);
  // A stock city with no row of its own: the new name, and the old one to geocode.
  const [elsewhere] = searchLocalPlaces(entries, "volgograd", 1);
  assert.equal(elsewhere.source, "rename");
  assert.equal(elsewhere.lookup, "stalingrad");
});

test("a group is found by its name or a former one, at its label", () => {
  const groups = buildGroupIndex([
    { type: "Feature", properties: { group: "Northern Militia", regions: 3 }, geometry: { type: "Point", coordinates: [36.2, 49.9] } },
  ]);
  const entries = buildLocalPlaceEntries({
    groups,
    groupRecords: { "Northern Militia": { name: "Northern Militia", formerNames: ["People's Guard"] } },
  });
  const [byName] = searchLocalPlaces(entries, "northern mil", 1);
  assert.deepEqual([byName.source, byName.lng, byName.lat, byName.detail], ["group", 36.2, 49.9, "Group"]);
  assert.equal(searchLocalPlaces(entries, "people s guard", 1)[0]?.name, "Northern Militia");
});

test("a group named for the town it holds is listed beside the town", () => {
  const entries = buildLocalPlaceEntries({
    cities: [city("Donetsk", 37.8, 48.0)],
    groups: [{ group: "Donetsk", lng: 37.9, lat: 48.1, regions: 1 }],
  });
  assert.deepEqual(searchLocalPlaces(entries, "donetsk", 3).map((entry) => entry.source).sort(), ["city", "group"]);
});

test("a unit is found by name and opens its card", () => {
  const entries = buildLocalPlaceEntries({
    units: [
      { id: "u1", name: "3rd Army", type: "armor", ownerCode: "France", lng: 4.8, lat: 45.7 },
      { id: "u2", name: "Nameless", type: "infantry", ownerCode: "France" },
    ],
  });
  const [army] = searchLocalPlaces(entries, "3rd army", 1);
  assert.equal(army.detail, "Armor · France");
  assert.deepEqual(army.payload, { source: "unit", id: "u1", lngLat: { lng: 4.8, lat: 45.7 } });
  assert.equal(searchLocalPlaces(entries, "nameless", 1).length, 0, "a unit with no position is not offered");
});

test("the group index is published and cleared like the others", () => {
  publishGroupIndex([{ type: "Feature", properties: { group: "Cartel", regions: 2 }, geometry: { type: "Point", coordinates: [-99, 19] } }]);
  assert.deepEqual(getWorldPlaceIndex().groups, [{ group: "Cartel", lng: -99, lat: 19, regions: 2 }]);
  publishGroupIndex(null);
  assert.deepEqual(getWorldPlaceIndex().groups, []);
});
