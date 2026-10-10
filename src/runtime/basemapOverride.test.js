/*! Open Historia — the player's basemap pick: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/basemapOverride.test.js
//
// Settings > Map lets a player put a built-in basemap under the map. It may
// replace a scenario's built-in basemap, never a scenario's own map.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { DEFAULT_BASEMAP_ID, basemapOverrideFor, resolveBasemapId } from "./assets.js";

test("a player's pick replaces a scenario's built-in basemap", () => {
  assert.equal(basemapOverrideFor("dark-gray"), "dark-gray");
  assert.equal(resolveBasemapId({ overrideId: basemapOverrideFor("dark-gray"), scenarioId: "ocean" }), "dark-gray");
  // Nothing picked, or a value no build knows: the scenario's basemap.
  assert.equal(basemapOverrideFor(""), "");
  assert.equal(basemapOverrideFor("somewhere-else"), "");
  assert.equal(resolveBasemapId({ overrideId: basemapOverrideFor(""), scenarioId: "ocean-dark" }), "ocean-dark");
  assert.equal(resolveBasemapId({ overrideId: "", scenarioId: "" }), DEFAULT_BASEMAP_ID);
});

test("a scenario with a map of its own keeps it whatever the player picked", () => {
  assert.equal(basemapOverrideFor("dark-gray", { scenarioHasOwnMap: true }), "");
  assert.equal(basemapOverrideFor("ocean", { scenarioHasOwnMap: true }), "");
  assert.equal(basemapOverrideFor("dark-gray", { scenarioHasOwnMap: false }), "dark-gray");
});

test("on a real-Earth scenario the pick counts only if the scenario allows that map", () => {
  // No choice made by the author: any built-in map.
  assert.equal(basemapOverrideFor("imagery", { allowedBasemaps: null }), "imagery");
  assert.equal(basemapOverrideFor("topo", { allowedBasemaps: ["topo"] }), "topo");
  assert.equal(basemapOverrideFor("imagery", { allowedBasemaps: ["topo"] }), "");
  // An empty list: the scenario's own basemap only.
  assert.equal(basemapOverrideFor("imagery", { allowedBasemaps: [] }), "");
});

test("a scenario's own map wins over its allowed list", () => {
  assert.equal(basemapOverrideFor("topo", { scenarioHasOwnMap: true, allowedBasemaps: ["topo"] }), "");
  assert.equal(basemapOverrideFor("topo", { scenarioHasOwnMap: true, allowedBasemaps: null }), "");
});

test("the game map and Settings both follow the rule", () => {
  const world = fs.readFileSync(new URL("../Game/Map/World.jsx", import.meta.url), "utf8");
  assert.match(world, /basemapOverrideFor\(basemapOverride, \{ scenarioHasOwnMap: bgDeclared, allowedBasemaps \}\)/);
  const settings = fs.readFileSync(new URL("../Game/GameUI/settings.jsx", import.meta.url), "utf8");
  // In a game the pick is switched off, shown as the scenario's own, and says
  // why. The main menu's Settings are for every game, so there it stays on.
  assert.match(settings, /const ownMap = forGame && hasOwnMap\(background\);/);
  assert.match(settings, /const choices = ownMap \? \[\] : /);
  assert.match(settings, /const shown = basemapOverrideFor\(value, \{ scenarioHasOwnMap: ownMap, allowedBasemaps: allowed \}\);/);
  assert.match(settings, /value=\{shown\} disabled=\{off\}/);
  assert.match(settings, /This scenario uses its own basemap, which cannot be replaced\./);
});
