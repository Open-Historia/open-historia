/*! Open Historia — the scenario's maps in a game, and the one a player sees: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/basemapPick.test.js
//
// In a game, Settings → Map lists the scenario's maps (CONTEXT.md, ADR 0007)
// and the player picks one for that game. What has to hold:
//   - the list is the scenario's maps by name, the starting map first;
//   - the game's own pick wins, then the player's default basemap where the
//     scenario offers it, then the starting map;
//   - a detailed map is drawn over the drawn map it is shown over, which is
//     what a player who turned detailed maps off sees.
import test from "node:test";
import assert from "node:assert/strict";

import { basemapShownFor, migrateBasemapSettings, scenarioMapsOfWorld, STARTING_DRAWN_PICK } from "./basemapPick.js";

const GOT = {
  background: { kind: "vector", name: "Westeros map", tiled: { id: "got-world", version: 2, name: "Westeros relief" } },
  allowedBasemaps: ["ocean"],
  ownBasemaps: [
    { id: "parchment", name: "Old parchment", kind: "image" },
    { id: "essos", name: "Essos", kind: "vector" },
    { id: "essos-relief", name: "Essos relief", kind: "tiled", tiled: { hash: "a".repeat(64) }, over: "essos" },
  ],
};
const lines = (maps) => maps.map((map) => `${map.starting ? "★ " : ""}${map.pick || "''"} ${map.kind} "${map.name}"${map.over != null ? ` over ${map.over || "''"}` : ""}`);

test("the scenario's maps, the starting map first", () => {
  assert.deepEqual(lines(scenarioMapsOfWorld(GOT)), [
    `★ '' detailed "Westeros relief" over ${STARTING_DRAWN_PICK}`,
    `${STARTING_DRAWN_PICK} vector "Westeros map"`,
    'own:parchment image "Old parchment"',
    'own:essos vector "Essos"',
    'own:essos-relief detailed "Essos relief" over own:essos',
    'ocean builtin "Ocean"',
  ]);
  // A real-world scenario that never chose: its built-in map, then every other.
  const earth = scenarioMapsOfWorld({ basemap: "topo" });
  assert.equal(earth[0].name, "Topographic");
  assert.equal(earth.length, 15);
  // A made-up world saved before names: still a name.
  assert.deepEqual(lines(scenarioMapsOfWorld({ background: { kind: "image" } })), ['★ \'\' image "Scenario map"']);
  // A detailed map over the starting map's drawing, when that is a picture: not offered.
  assert.equal(scenarioMapsOfWorld({ background: { kind: "image" }, ownBasemaps: [{ id: "r", name: "R", kind: "tiled", tiled: { id: "x" }, over: "" }] }).length, 1);
});

test("the game's own pick wins, then the default basemap where offered, then the starting map", () => {
  const maps = scenarioMapsOfWorld({ basemap: "topo", allowedBasemaps: ["ocean", "imagery"] });
  assert.equal(basemapShownFor({ maps, gamePick: "imagery", defaultBasemap: "ocean", useDefault: true }).pick, "imagery");
  assert.equal(basemapShownFor({ maps, gamePick: "", defaultBasemap: "ocean", useDefault: true }).pick, "", "the game chose its starting map");
  assert.equal(basemapShownFor({ maps, gamePick: null, defaultBasemap: "ocean", useDefault: true }).pick, "ocean");
  assert.equal(basemapShownFor({ maps, gamePick: null, defaultBasemap: "ocean", useDefault: false }).pick, "");
  assert.equal(basemapShownFor({ maps, gamePick: null, defaultBasemap: "streets", useDefault: true }).pick, "", "not offered: the starting map");
  assert.equal(basemapShownFor({ maps, gamePick: "streets" }).pick, "", "a pick this scenario does not offer");
  // A made-up world never gets the Earth from the default.
  assert.equal(basemapShownFor({ maps: scenarioMapsOfWorld(GOT), gamePick: null, defaultBasemap: "imagery", useDefault: true }).pick, "");
});

test("a detailed map is drawn over the drawn map it is shown over", () => {
  const maps = scenarioMapsOfWorld(GOT);
  const start = basemapShownFor({ maps, gamePick: null });
  assert.equal(start.kind, "detailed");
  assert.deepEqual(start.detailed, { id: "got-world", version: 2 });
  assert.equal(start.over, STARTING_DRAWN_PICK);
  const essos = basemapShownFor({ maps, gamePick: "own:essos-relief" });
  assert.deepEqual(essos.detailed, { hash: "a".repeat(64) });
  assert.equal(essos.over, "own:essos");
  // Detailed maps off on this device: the drawn map under it.
  const off = basemapShownFor({ maps, gamePick: "own:essos-relief", showDetailed: false });
  assert.equal(off.pick, "own:essos");
  assert.equal(off.detailed, null);
  assert.equal(basemapShownFor({ maps, gamePick: null, showDetailed: false }).pick, STARTING_DRAWN_PICK);
  // The other detailed maps, said once beside the download offer.
  assert.deepEqual(start.otherDetailed.map((map) => map.name), ["Essos relief"]);
});

test("a pick saved for every game before becomes the default basemap", () => {
  const store = new Map([["map_basemap_style", "imagery"]]);
  migrateBasemapSettings(store);
  assert.equal(store.get("map_basemap_default"), "imagery");
  assert.equal(store.get("map_basemap_default_on"), "1");
  assert.equal(store.has("map_basemap_style"), false);
  // One that is not a built-in map (another scenario's own map) is dropped.
  const own = new Map([["map_basemap_style", "own:terrain"]]);
  migrateBasemapSettings(own);
  assert.equal(own.has("map_basemap_default"), false);
  assert.equal(own.has("map_basemap_style"), false);
  // Nothing saved: nothing changes.
  const none = new Map();
  migrateBasemapSettings(none);
  assert.equal(none.size, 0);
});
