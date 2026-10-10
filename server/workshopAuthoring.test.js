/*! Open Historia — what the Scenario Workshop authors besides the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/workshopAuthoring.test.js
//
// Groups and the areas they control: authored in the Workshop, exported into
// the scenario's world, read back when the Workshop opens the scenario again,
// and inherited by a game.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildGameSeed } from "../src/Editor/exportPreset.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

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

// The Workshop's map does not load under bare node, so the stamp is checked
// in its source: the scenario's areas reach both loaders, and each sets every
// region's group, or none.
test("the Workshop opens with the world's group areas stamped onto its regions", () => {
  const map = read("../src/Editor/OlMap.jsx");
  assert.ok(map.includes("loadRegions: (fc, ownershipOverrides = null, groupAreas = null) =>"));
  assert.ok(map.includes("reseedWorldWithOwners: (overrides = {}, groupAreas = null) =>"));
  const stamp = 'if (groupAreas && id != null) f.set("group", String(groupAreas[String(id)] ?? "").trim() || null);';
  assert.equal(map.split(stamp).length, 3, "both loaders stamp, and clear what the world does not name");
  const editor = read("../src/Editor/MapEditor.jsx");
  assert.ok(editor.includes("api.loadRegions(initialMap.regions, initialMap.ownershipOverrides || {}, initialMap.groupAreas || null)"));
  assert.ok(editor.includes("api.reseedWorldWithOwners(initialMap.ownershipOverrides || {}, initialMap.groupAreas || null)"));
  const library = read("../src/Game/GameUI/libraryBar.jsx");
  assert.ok(library.includes('groupAreas: world.groupAreas && typeof world.groupAreas === "object"'), "the scenario's areas are handed to the Workshop");
});

test("a new game inherits the groups the Workshop authored, even from a scenario played in place", () => {
  for (const source of [read("./libraryStore.js"), read("../src/runtime/web/storeConstants.js")]) {
    for (const key of ["groups", "groupAreas"]) {
      assert.match(source, new RegExp(`"${key}",`), `${key} is a template world key`);
    }
  }
});
