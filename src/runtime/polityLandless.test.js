// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
import test from "node:test";
import assert from "node:assert/strict";

import { isPolityLandless } from "./gameState.js";

const world = (extra = {}) => ({
  polityOverrides: {
    Ruritania: { code: "Ruritania", name: "Ruritania", aliases: ["Kingdom of Ruritania"] },
    "Free Syldavia": { code: "Free Syldavia", name: "Free Syldavia", aliases: [] },
  },
  regionOwnershipOverrides: { r1: "Ruritania", r2: "Borduria" },
  ...extra,
});

test("a polity that administers a region is not landless", () => {
  assert.equal(isPolityLandless(world(), "Ruritania"), false);
  assert.equal(isPolityLandless(world(), "ruritania"), false, "names compare case-insensitively, as before");
});

test("a declared polity with no region is landless", () => {
  assert.equal(isPolityLandless(world(), "Free Syldavia"), true);
});

test("being the lawful sovereign of an occupied region counts as land", () => {
  const occupied = world({ regionSovereigntyOverrides: { r2: "Free Syldavia" } });
  assert.equal(isPolityLandless(occupied, "Free Syldavia"), false);
});

test("an owner written under one of the polity's aliases still folds onto it", () => {
  const aliased = world({ regionOwnershipOverrides: { r1: "Kingdom of Ruritania", r2: "Borduria" } });
  assert.equal(isPolityLandless(aliased, "Ruritania"), false);
});

test("a stock map with no ownership list owns its country through the base tiles", () => {
  assert.equal(isPolityLandless({ polityOverrides: {} }, "Spain"), false);
  assert.equal(isPolityLandless({}, "Spain"), false);
  assert.equal(isPolityLandless({ polityOverrides: { Spain: { code: "Spain", name: "Spain" } } }, "Spain"), true,
    "a declared polity on a map without overrides has no base tiles to fall back on");
});

test("no polity, no world: never landless", () => {
  assert.equal(isPolityLandless(world(), ""), false);
  assert.equal(isPolityLandless(null, "Ruritania"), false);
});
