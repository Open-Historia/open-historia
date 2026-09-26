/*! Open Historia — what the Scenario Workshop authors besides the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/workshopAuthoring.test.js
//
// Groups and the areas they control, map features that are not cities (bases,
// ports, landmarks), puppet states, and cities' population by year: each is
// authored in the Workshop, exported into the scenario's world or cities, read
// back when the Workshop opens the scenario again, and inherited by a game.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildGameSeed } from "../src/Editor/exportPreset.js";
import { claimStamper } from "../src/Editor/claimOverrides.js";
import { MAP_FEATURE_STATUSES, buildMarkersForGame, isMapFeature, markerToFeature, newMapFeature } from "../src/Editor/mapFeatures.js";
import { buildPuppetsForGame, overlordChoicesFor, setOverlord, withoutPolities } from "../src/Editor/scenarioPuppets.js";
import { cityRowToFeature } from "../src/Editor/cityMarkers.js";
import { MARKER_STATUSES, normalizeWorldState } from "../src/runtime/gameState.js";
import { renamePolityInDocument, renamePolityInWorld } from "./polityRename.js";

const square = (x) => ({ type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
const region = (id, owner, x, extra = {}) => ({ type: "Feature", id, properties: { id, name: id, owner, typeId: "land", ...extra }, geometry: square(x) });
const regions = (...features) => ({ type: "FeatureCollection", features });
const doc = (extra = {}) => ({
  name: "test",
  metadata: { kind: "import-world", startDate: "1950-01-01" },
  types: [{ id: "land", name: "Land" }],
  features: [],
  colorOverrides: {},
  flags: {},
  tags: {},
  polities: { Mexico: { name: "Mexico", code: "Mexico", aliases: ["Mexico"], status: "active", note: "" } },
  ...extra,
});

test("groups export as the world's groups and areas, and never into the regions file", () => {
  const seed = buildGameSeed(
    doc({ groups: { "Cartel del Norte": { name: "Cartel del Norte", description: "Runs the border towns.", color: "#e11d48" } } }),
    regions(region("r1", "Mexico", 0, { group: "Cartel del Norte" }), region("r2", "Mexico", 1, { group: "Zombies" }), region("r3", "Mexico", 2)),
  );
  assert.deepEqual(Object.keys(seed.world.groups).sort(), ["Cartel del Norte", "Zombies"], "a group named on a region is a group, registry or not");
  assert.equal(seed.world.groups["Cartel del Norte"].description, "Runs the border towns.");
  assert.match(seed.world.groups.Zombies.color, /^#[0-9a-f]{6}$/);
  assert.deepEqual(seed.world.groupAreas, { r1: "Cartel del Norte", r2: "Zombies" });
  assert.ok(seed.regions.features.every((feature) => !("group" in feature.properties)), "the regions file carries no group");
  assert.deepEqual(seed.world.regionOwnershipOverrides, { r1: "Mexico", r2: "Mexico", r3: "Mexico" }, "a group's area moves no owner");
});

test("the Workshop opens with the world's group areas stamped onto its regions", () => {
  const features = ["a", "b"].map((id) => {
    const values = new Map([["group", id === "b" ? "Stale" : null]]);
    return { getId: () => id, get: (key) => values.get(key), set: (key, value) => values.set(key, value) };
  });
  const stamp = claimStamper({ groupAreas: { a: "Cartel" } });
  features.forEach(stamp);
  assert.equal(features[0].get("group"), "Cartel");
  assert.equal(features[1].get("group"), null, "the world is the whole truth about areas");
});

test("a map feature that is not a city goes to world.markers, with a stable id, and never into the cities", () => {
  const base = newMapFeature({ id: "feat_1", coord: [-99.1, 19.4], owner: "Mexico", createdAt: "2026-01-01T00:00:00.000Z" });
  const base2 = { ...base, name: "Campo Militar 1", kind: "military base", note: "The capital's garrison." };
  const city = { id: "feat_2", name: "Monterrey", type: "Coordinate", coord: [-100.3, 25.7], population: 1100000, tags: ["city"] };
  assert.equal(isMapFeature(base2), true);
  assert.equal(isMapFeature(city), false);
  assert.equal(isMapFeature({ ...city, kind: "port" }), false, "a city with a kind is still a city");

  const seed = buildGameSeed(doc({ features: [base2, city] }), regions(region("r1", "Mexico", 0)));
  assert.deepEqual(seed.cities.features.map((feature) => feature.properties.city), ["Monterrey"]);
  assert.equal(seed.world.markers.length, 1);
  const [marker] = seed.world.markers;
  assert.equal(marker.id, "marker-feat_1");
  assert.equal(marker.kind, "military base");
  assert.equal(marker.ownerCode, "Mexico");
  assert.equal(marker.createdAt, "2026-01-01T00:00:00.000Z");

  // The game keeps it as the Workshop wrote it.
  const read = normalizeWorldState({ markers: seed.world.markers });
  assert.equal(read.markers[0].id, "marker-feat_1");
  assert.equal(read.markers[0].note, "The capital's garrison.");
});

test("a scenario's structures open as map features and save back whole", () => {
  const marker = {
    id: "marker-77",
    name: "Port of Veracruz",
    kind: "port",
    ownerCode: "Mexico",
    lng: -96.13,
    lat: 19.2,
    note: "",
    status: "damaged",
    aliases: ["Veracruz harbour"],
    sourceEventIds: ["e1"],
    createdAt: "2025-03-01T00:00:00.000Z",
    foundedAt: "1519",
  };
  const feature = markerToFeature(marker, "feat_9");
  assert.equal(feature.markerId, "marker-77");
  assert.equal(feature.status, "damaged");
  const [back] = buildMarkersForGame([{ ...feature, note: "Shelled in March." }]);
  assert.equal(back.id, "marker-77");
  assert.deepEqual(back.aliases, ["Veracruz harbour"], "what the Workshop does not edit comes back as it was");
  assert.deepEqual(back.sourceEventIds, ["e1"]);
  assert.equal(back.foundedAt, "1519");
  assert.equal(back.note, "Shelled in March.");
  assert.equal(markerToFeature({ name: "", lng: 1, lat: 1 }, "x"), null);
  assert.deepEqual([...MAP_FEATURE_STATUSES].sort(), [...MARKER_STATUSES].sort(), "the Workshop offers the game's statuses");
});

test("puppet states follow the ledger's rules and export as world.puppets rows", () => {
  let { puppets, error } = setOverlord([], "Manchukuo", "Japan", { kind: "satellite", loyalty: 30 });
  assert.equal(error, "");
  ({ puppets, error } = setOverlord(puppets, "Mengjiang", "Manchukuo"));
  assert.match(error, /itself a puppet/, "no chains: a puppet holds no puppets");
  ({ puppets, error } = setOverlord(puppets, "Japan", "Germany"));
  assert.match(error, /holds puppets of its own/);
  ({ error } = setOverlord(puppets, "Japan", "Japan"));
  assert.match(error, /its own puppet/);
  assert.deepEqual(overlordChoicesFor(puppets, "Mengjiang", ["Japan", "Manchukuo", "Mengjiang", "China"]), ["Japan", "China"]);
  assert.deepEqual(overlordChoicesFor(puppets, "Japan", ["Germany"]), [], "an overlord answers to no one");

  const seed = buildGameSeed(doc({ puppets }), regions(region("r1", "Japan", 0), region("r2", "Manchukuo", 1)));
  assert.equal(seed.world.puppets.length, 1);
  const [row] = seed.world.puppets;
  assert.equal(row.overlord, "Japan");
  assert.equal(row.puppet, "Manchukuo");
  assert.equal(row.kind, "satellite");
  assert.equal(row.loyalty, 30);
  assert.equal(row.startedDate, "1950-01-01", "the scenario's start");
  assert.deepEqual(row.knownTo.map((entry) => entry.polity).sort(), ["Japan", "Manchukuo"]);
  const read = normalizeWorldState({ puppets: seed.world.puppets });
  assert.equal(read.puppets[0].overlord, "Japan");
  assert.equal(read.puppets[0].status, "active");

  ({ puppets } = setOverlord(puppets, "Manchukuo", ""));
  assert.deepEqual(puppets, [], "independent again");
  assert.deepEqual(withoutPolities([{ overlord: "A", puppet: "B" }, { overlord: "C", puppet: "D" }], "B"), [{ overlord: "C", puppet: "D" }]);
});

test("renaming a polity renames it in its subordinations, in the Workshop and in play", () => {
  const rows = [{ id: "p1", overlord: "Japan", puppet: "Manchukuo", kind: "satellite", knownTo: [{ polity: "Manchukuo", learnedDate: "" }, "Japan"], status: "active" }];
  const renamedDoc = renamePolityInDocument(
    { polities: { Manchukuo: { name: "Manchukuo" }, Japan: { name: "Japan" } }, puppets: rows, units: [{ id: "u1", ownerCode: "Manchukuo" }] },
    "Manchukuo",
    "Manchoukuo",
  );
  assert.equal(renamedDoc.puppets[0].puppet, "Manchoukuo");
  assert.equal(renamedDoc.puppets[0].knownTo[0].polity, "Manchoukuo");
  assert.equal(renamedDoc.units[0].ownerCode, "Manchoukuo", "a unit placed for it follows it too");
  const { world } = renamePolityInWorld({ polityOverrides: { Japan: { name: "Japan" } }, puppets: rows }, "Japan", "Empire of Japan");
  assert.equal(world.puppets[0].overlord, "Empire of Japan");
  assert.equal(world.puppets[0].knownTo[1], "Empire of Japan");
});

test("a city's population by year survives import, export and the scenario round trip", () => {
  const imported = cityRowToFeature({ name: "Lagos", coord: [3.4, 6.5], population: 0, populationByYear: { 1950: 300000, 2000: 7000000 } }, "feat_3");
  assert.deepEqual(imported.populationByYear, { 1950: 300000, 2000: 7000000 });
  const seed = buildGameSeed(doc({ features: [imported] }), regions(region("r1", "Nigeria", 0)));
  assert.deepEqual(seed.cities.features[0].properties.populationByYear, { 1950: 300000, 2000: 7000000 });
  const editor = readFileSync(new URL("../src/Editor/MapEditor.jsx", import.meta.url), "utf8");
  assert.ok(editor.includes("...populationByYearField(f.properties)"), "the Workshop reopens a scenario's cities with their series");
});

test("a new game inherits what the Workshop authored, even from a scenario played in place", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const source of [read("./libraryStore.js"), read("../src/runtime/web/storeConstants.js")]) {
    for (const key of ["markers", "puppets", "groups", "groupAreas"]) {
      assert.match(source, new RegExp(`"${key}",`), `${key} is a template world key`);
    }
  }
});
