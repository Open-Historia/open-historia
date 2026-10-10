/*! Open Historia — which map the Maps window marks "In use": tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/basemapInUse.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { basemapInUse } from "./basemapInUse.js";

const westeros = { id: "got-world-v1", kind: "tiled", official: { id: "got-world", version: 1 }, contentHash: "abc" };
const mine = { id: "bm-1", kind: "vector" };

test("a scenario on a built-in basemap marks that built-in in use", () => {
  const inUse = basemapInUse({ builtinId: "ocean" });
  assert.equal(inUse.builtin("ocean"), true);
  assert.equal(inUse.builtin("topo"), false);
  assert.equal(inUse.library(mine), false);
});

test("a scenario with a map of its own never marks a built-in in use", () => {
  // GoT: its own drawn map, with Ocean left behind as the document's basemap.
  const inUse = basemapInUse({ builtinId: "ocean", hasOwnMap: true });
  assert.equal(inUse.builtin("ocean"), false);
});

test("the basemap just picked from Your basemaps is the one in use", () => {
  const inUse = basemapInUse({ builtinId: "ocean", hasOwnMap: true, libraryId: "bm-1" });
  assert.equal(inUse.library(mine), true);
  assert.equal(inUse.library({ id: "bm-2", kind: "vector" }), false);
});

test("the scenario's detailed map is in use, whether named by official id or by checksum", () => {
  const official = basemapInUse({ builtinId: "ocean", hasOwnMap: true, detailedMap: { id: "got-world", version: 1 } });
  assert.equal(official.library(westeros), true);
  assert.equal(official.builtin("ocean"), false);
  const own = basemapInUse({ hasOwnMap: true, detailedMap: { hash: "abc" } });
  assert.equal(own.library(westeros), true);
  assert.equal(own.library({ ...westeros, contentHash: "other", official: null }), false);
  // A painted basemap is never the detailed map.
  assert.equal(official.library({ ...mine, official: { id: "got-world" } }), false);
});
