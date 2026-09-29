import assert from "node:assert/strict";
import test from "node:test";

import { buildPolityIndex } from "./placeSearch.js";

const site = (owner, lng, lat, priorityScale, properties = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { owner, priorityScale, ...properties },
});

test("a polity's search home is its primary label site even when a dependency is larger", () => {
  const rows = buildPolityIndex([
    site("__part_denmark_0__", -40, 72, 900, { sourceOwner: "Kingdom of Denmark", labelSiteRole: "sovereign-secondary" }),
    site("Kingdom of Denmark", 10, 56, 120, { labelSiteRole: "sovereign-primary" }),
  ]);
  assert.deepEqual(rows, [{ owner: "Kingdom of Denmark", lng: 10, lat: 56, weight: 120 }]);
});

test("without a primary site the most prominent label site is the home", () => {
  const rows = buildPolityIndex([
    site("__part_a__", 1, 1, 10, { sourceOwner: "Atlantis", labelSiteRole: "sovereign-secondary" }),
    site("__part_b__", 2, 2, 30, { sourceOwner: "Atlantis", labelSiteRole: "sovereign-secondary" }),
  ]);
  assert.deepEqual(rows, [{ owner: "Atlantis", lng: 2, lat: 2, weight: 30 }]);
});

test("the polity index skips non-sovereign label sites", () => {
  const rows = buildPolityIndex([
    site("__territory_x__", 5, 5, 99, { sourceOwner: "Atlantis", labelKind: "territory", labelSiteRole: "geographic-territory" }),
    site("Atlantis", 0, 0, 1, { labelKind: "polity" }),
  ]);
  assert.deepEqual(rows, [{ owner: "Atlantis", lng: 0, lat: 0, weight: 1 }]);
});
