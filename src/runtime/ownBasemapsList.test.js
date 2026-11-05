/*! Open Historia — the scenario's other maps in world state: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/ownBasemapsList.test.js
//
// world.ownBasemaps lists the scenario's maps beside its starting one
// (CONTEXT.md, docs/adr/0007): pictures and drawn maps, whose payloads ride in
// the ownBasemapsData asset, and detailed maps, named and never carried. World
// state carries the list as one string; which map a player sees is
// basemapPick.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { DEFAULT_BASEMAP_ID, decodeOwnBasemaps, encodeOwnBasemaps, ownBasemapIdOf, ownBasemapPick, resolveBasemapId } from "./assets.js";

const OWN = [{ id: "political", name: "Political", kind: "image" }, { id: "terrain", name: "Terrain", kind: "vector" }];

test("a pick of one is its id behind own:", () => {
  assert.equal(ownBasemapPick("terrain"), "own:terrain");
  assert.equal(ownBasemapIdOf("own:terrain"), "terrain");
  assert.equal(ownBasemapIdOf("topo"), "");
  // Never a built-in map's place: an own pick is not one.
  assert.equal(resolveBasemapId({ overrideId: "own:terrain", scenarioId: "ocean-dark" }), "ocean-dark");
  assert.equal(resolveBasemapId({ overrideId: "", scenarioId: "" }), DEFAULT_BASEMAP_ID);
});

test("the list is read back from world state the one way", () => {
  assert.equal(encodeOwnBasemaps(null), null);
  assert.equal(encodeOwnBasemaps([]), null);
  assert.deepEqual(decodeOwnBasemaps(encodeOwnBasemaps(OWN)), OWN);
  // A broken or odd entry is left out, not shown as a choice.
  assert.deepEqual(decodeOwnBasemaps(encodeOwnBasemaps([...OWN, { id: "x", kind: "plain" }, { kind: "image" }])), OWN);
  assert.deepEqual(decodeOwnBasemaps("not json"), []);
});

test("a detailed map in it is named, shown over a drawn map of the list or the starting map's", () => {
  const relief = { id: "relief", name: "Relief", kind: "tiled", tiled: { id: "got-world", version: 2 }, over: "terrain" };
  assert.deepEqual(decodeOwnBasemaps(encodeOwnBasemaps([...OWN, relief])).at(-1), relief);
  // Over a picture, or a map the list lacks: left out.
  assert.deepEqual(decodeOwnBasemaps(encodeOwnBasemaps([...OWN, { ...relief, over: "political" }])), OWN);
  assert.deepEqual(decodeOwnBasemaps(encodeOwnBasemaps([...OWN, { ...relief, over: "gone" }])), OWN);
  // Named by neither an official id nor a checksum: left out.
  assert.deepEqual(decodeOwnBasemaps(encodeOwnBasemaps([...OWN, { ...relief, tiled: { id: "Bad Id!" } }])), OWN);
  // The starting map's drawing: "".
  assert.equal(decodeOwnBasemaps(encodeOwnBasemaps([{ ...relief, over: "" }]))[0].over, "");
});

test("the game map and Settings both read the pick through basemapPick.js", () => {
  const world = fs.readFileSync(new URL("../Game/Map/World.jsx", import.meta.url), "utf8");
  assert.match(world, /basemapShownFor\(\{ maps: scenarioMapList, gamePick, defaultBasemap, useDefault, showDetailed \}\)/);
  const settings = fs.readFileSync(new URL("../Game/GameUI/settings.jsx", import.meta.url), "utf8");
  assert.match(settings, /basemapShownFor\(\{ maps, gamePick, defaultBasemap, useDefault \}\)/);
  assert.match(settings, /\{forGame \? <GameBasemapField \/> : <DefaultBasemapField \/>\}/);
});
