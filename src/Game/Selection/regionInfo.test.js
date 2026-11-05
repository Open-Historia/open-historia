/*! Open Historia — the region card's Region info: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Selection/regionInfo.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { regionInfoFor } from "./regionInfo.js";

// Three regions in a row, west to east, each a 2-degree box.
const region = (id, name, country, west, extra = {}) => ({
  id, name, country, lng: west + 1, lat: 1, bounds: [[west, 0], [west + 2, 2]], adjacencies: [], ...extra,
});
const catalog = [
  region("r1", "Westmark", "Alba", 0),
  region("r2", "Midland", "Alba", 2),
  region("r3", "Eastvale", "Brun", 4, { lng: 4.5 }),
  region("far", "Faraway", "Brun", 40),
];

test("the neighbours are the regions touching this one, grouped by who holds them", () => {
  const info = regionInfoFor({ regionId: "r2", catalog });
  assert.deepEqual(info.neighbours, [
    { owner: "Alba", regions: ["Westmark"] },
    { owner: "Brun", regions: ["Eastvale"] },
  ]);
});

test("who holds a neighbour is who holds it now", () => {
  const info = regionInfoFor({ regionId: "r2", catalog, ownerOf: (id, entry) => (id === "r3" ? "Alba" : entry.country) });
  assert.deepEqual(info.neighbours, [{ owner: "Alba", regions: ["Eastvale", "Westmark"] }]);
});

test("declared adjacencies win over touching boxes, in either direction", () => {
  const withSea = catalog.map((entry) => (entry.id === "far" ? { ...entry, adjacencies: ["r2"] } : entry));
  const info = regionInfoFor({ regionId: "r2", catalog: withSea });
  assert.deepEqual(info.neighbours, [{ owner: "Brun", regions: ["Faraway"] }]);
});

test("the cities are the ones in the region, capital and biggest first, under their current names", () => {
  const cities = [
    { name: "Border Town", lng: 4, lat: 1, population: 900 },
    { name: "Midcastle", lng: 3.1, lat: 1.2, population: 40000, capital: true },
    { name: "Oldport", lng: 2.5, lat: 0.5, population: 120000 },
    { name: "Westford", lng: 0.5, lat: 1, population: 500000 },
  ];
  const info = regionInfoFor({ regionId: "r2", catalog, cities, cityRenames: { oldport: "New Harbour" } });
  assert.deepEqual(info.cities.map((city) => city.name), ["Midcastle", "New Harbour"],
    "a city on the shared edge goes to the nearer centre, one next door is not listed");
  assert.equal(info.cities[1].population, 120000);
});

test("a region the catalog does not know has nothing to show", () => {
  assert.equal(regionInfoFor({ regionId: "nowhere", catalog }), null);
  assert.equal(regionInfoFor({ regionId: "r1", catalog: null }), null);
});
