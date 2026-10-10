/*! Open Historia — the player's basemap pick: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/basemapOverride.test.js
//
// Settings > Map lets a player switch to another basemap the scenario's author
// offers: a built-in map they ticked, or another basemap of the scenario's own.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { DEFAULT_BASEMAP_ID, basemapOverrideFor, builtinBasemapChoices, decodeOwnBasemaps, encodeOwnBasemaps, ownBasemapIdOf, ownBasemapPick, resolveBasemapId } from "./assets.js";

test("a player's pick replaces a scenario's built-in basemap", () => {
  assert.equal(basemapOverrideFor("dark-gray"), "dark-gray");
  assert.equal(resolveBasemapId({ overrideId: basemapOverrideFor("dark-gray"), scenarioId: "ocean" }), "dark-gray");
  // Nothing picked, or a value no build knows: the scenario's basemap.
  assert.equal(basemapOverrideFor(""), "");
  assert.equal(basemapOverrideFor("somewhere-else"), "");
  assert.equal(resolveBasemapId({ overrideId: basemapOverrideFor(""), scenarioId: "ocean-dark" }), "ocean-dark");
  assert.equal(resolveBasemapId({ overrideId: "", scenarioId: "" }), DEFAULT_BASEMAP_ID);
});

test("a scenario with a map of its own that never chose offers no built-in map", () => {
  // A made-up world saved before the choice existed never gets the Earth
  // under it.
  assert.equal(basemapOverrideFor("dark-gray", { scenarioHasOwnMap: true }), "");
  assert.equal(basemapOverrideFor("ocean", { scenarioHasOwnMap: true, allowedBasemaps: null }), "");
  assert.deepEqual(builtinBasemapChoices(null, { scenarioHasOwnMap: true }), []);
  assert.equal(basemapOverrideFor("dark-gray", { scenarioHasOwnMap: false }), "dark-gray");
});

test("a scenario with a map of its own offers the built-in maps its author ticked", () => {
  assert.equal(basemapOverrideFor("topo", { scenarioHasOwnMap: true, allowedBasemaps: ["topo"] }), "topo");
  assert.equal(basemapOverrideFor("imagery", { scenarioHasOwnMap: true, allowedBasemaps: ["topo"] }), "");
  assert.equal(basemapOverrideFor("topo", { scenarioHasOwnMap: true, allowedBasemaps: [] }), "");
  assert.deepEqual(builtinBasemapChoices(["topo"], { scenarioHasOwnMap: true }).map((b) => b.id), ["topo"]);
});

test("on a real-Earth scenario the pick counts only if the scenario allows that map", () => {
  // No choice made by the author: any built-in map.
  assert.equal(basemapOverrideFor("imagery", { allowedBasemaps: null }), "imagery");
  assert.equal(basemapOverrideFor("topo", { allowedBasemaps: ["topo"] }), "topo");
  assert.equal(basemapOverrideFor("imagery", { allowedBasemaps: ["topo"] }), "");
  // An empty list: the scenario's own basemap only.
  assert.equal(basemapOverrideFor("imagery", { allowedBasemaps: [] }), "");
});

const OWN = [{ id: "political", name: "Political", kind: "image" }, { id: "terrain", name: "Terrain", kind: "vector" }];

test("a player can pick another basemap of the scenario's own", () => {
  assert.equal(ownBasemapPick("terrain"), "own:terrain");
  assert.equal(ownBasemapIdOf("own:terrain"), "terrain");
  assert.equal(ownBasemapIdOf("topo"), "");
  assert.equal(basemapOverrideFor("own:terrain", { scenarioHasOwnMap: true, ownBasemaps: OWN }), "own:terrain");
  // On a real-Earth scenario too, and whatever the built-in list says.
  assert.equal(basemapOverrideFor("own:political", { ownBasemaps: OWN, allowedBasemaps: [] }), "own:political");
  // One this scenario does not have (picked on another): its main map.
  assert.equal(basemapOverrideFor("own:elsewhere", { scenarioHasOwnMap: true, ownBasemaps: OWN }), "");
  assert.equal(basemapOverrideFor("own:terrain", { scenarioHasOwnMap: true }), "");
  // Never a built-in map's place: an own pick is not one.
  assert.equal(resolveBasemapId({ overrideId: "own:terrain", scenarioId: "ocean-dark" }), "ocean-dark");
});

test("the scenario's other basemaps are read back from world state the one way", () => {
  assert.equal(encodeOwnBasemaps(null), null);
  assert.equal(encodeOwnBasemaps([]), null);
  assert.deepEqual(decodeOwnBasemaps(encodeOwnBasemaps(OWN)), OWN);
  // A broken or odd entry is left out, not shown as a choice.
  assert.deepEqual(decodeOwnBasemaps(encodeOwnBasemaps([...OWN, { id: "x", kind: "plain" }, { kind: "image" }])), OWN);
  assert.deepEqual(decodeOwnBasemaps("not json"), []);
});

test("the game map and Settings both follow the rule", () => {
  const world = fs.readFileSync(new URL("../Game/Map/World.jsx", import.meta.url), "utf8");
  assert.match(world, /basemapOverrideFor\(basemapOverride, \{\s*scenarioHasOwnMap: bgDeclared,\s*allowedBasemaps,\s*ownBasemaps: decodeOwnBasemaps\(worldOwnBasemaps\),\s*\}\)/);
  const settings = fs.readFileSync(new URL("../Game/GameUI/settings.jsx", import.meta.url), "utf8");
  // In a game only what the scenario offers is listed; with nothing offered the
  // pick is switched off and says why. The main menu's Settings are for every
  // game, so there it stays on.
  assert.match(settings, /const ownMap = forGame && hasOwnMap\(background\);/);
  assert.match(settings, /const choices = builtinBasemapChoices\(allowed, \{ scenarioHasOwnMap: ownMap \}\);/);
  assert.match(settings, /const shown = basemapOverrideFor\(value, \{ scenarioHasOwnMap: ownMap, allowedBasemaps: allowed, ownBasemaps: own \}\);/);
  assert.match(settings, /value=\{shown\} disabled=\{off\}/);
  assert.match(settings, /This scenario uses its own basemap, which cannot be replaced\./);
});
