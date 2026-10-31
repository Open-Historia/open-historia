/*! Open Historia — basemap tiles and sea colours: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/basemapTiles.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { basemapSeaColour, basemapTileLoader } from "./assets.js";

test("a basemap tile that fails on a busy connection is asked for again", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) throw new TypeError("Failed to fetch");
    if (calls.length === 2) return new Response("", { status: 503 });
    return new Response(new Uint8Array([1, 2, 3]));
  };
  try {
    // z5 is below the placeholder check, so only the tile itself is fetched.
    const { data } = await basemapTileLoader({ url: "ohbase://streets/5/10/12" }, new AbortController());
    assert.deepEqual([...new Uint8Array(data)], [1, 2, 3]);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((url) => url.includes("World_Street_Map/MapServer/tile/5/10/12")));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a 404 basemap tile is not asked for again", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("", { status: 404 }); };
  try {
    await assert.rejects(basemapTileLoader({ url: "ohbase://streets/5/10/12" }, new AbortController()), /HTTP 404/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("each light basemap names its sea colour", () => {
  assert.equal(basemapSeaColour("streets"), "#99d9f2");
  assert.equal(basemapSeaColour("ocean-dark"), null, "dark variants keep their own dark background");
});
