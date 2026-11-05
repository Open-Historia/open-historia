/*! Open Historia — library catalog refresh tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/libraryRefresh.test.js
//
// Every library write rebuilds the catalog (GET /api/library, a whole IndexedDB
// catalog build on the web and on Android) unless told not to. The Workshop's
// save is seven writes; it must cost one rebuild, not seven.

import assert from "node:assert/strict";
import test from "node:test";

const requests = [];
let failWrites = false;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || "GET";
  requests.push(`${method} ${url}`);
  if (failWrites && method !== "GET") {
    return new Response(JSON.stringify({ error: "disk full" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const body = url === "/api/library" ? { games: [], scenarios: [] } : { scenario: { id: "s1" } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};

const {
  clearGameAsset,
  clearScenarioAsset,
  saveGame,
  saveScenario,
  uploadGameAsset,
  uploadScenarioAsset,
  withSingleLibraryRefresh,
} = await import("./library.js");

const catalogReads = () => requests.filter((line) => line === "GET /api/library").length;
const reset = () => {
  requests.length = 0;
  failWrites = false;
};
const json = (value) => new Blob([JSON.stringify(value)], { type: "application/json" });

test("each write on its own still refreshes the catalog", async () => {
  reset();
  await saveScenario("s1", {});
  await uploadScenarioAsset("s1", "colors", json({}));
  await clearScenarioAsset("s1", "flags");
  await saveGame("g1", {});
  await uploadGameAsset("g1", "cover", new Blob([new Uint8Array([1])], { type: "image/png" }));
  await clearGameAsset("g1", "cover");
  assert.equal(catalogReads(), 6);
});

test("refresh: false skips it, and a batch refreshes once after its last write", async () => {
  reset();
  await withSingleLibraryRefresh(async () => {
    await saveScenario("s1", { name: "Map" }, { refresh: false });
    await uploadScenarioAsset("s1", "colors", json({}), { refresh: false });
    await clearScenarioAsset("s1", "flags", { refresh: false });
    await uploadScenarioAsset("s1", "regionsGeojson", json({ type: "FeatureCollection", features: [] }), { refresh: false });
    await saveGame("g1", {}, { refresh: false });
    await uploadGameAsset("g1", "cover", new Blob([new Uint8Array([1])], { type: "image/png" }), { refresh: false });
    await clearGameAsset("g1", "cover", { refresh: false });
  });
  assert.equal(catalogReads(), 1);
  assert.equal(requests.at(-1), "GET /api/library", "the refresh comes after every write");
});

test("a batch that fails part-way still refreshes, and still reports the failure", async () => {
  reset();
  await assert.rejects(
    withSingleLibraryRefresh(async () => {
      await uploadScenarioAsset("s1", "colors", json({}), { refresh: false });
      failWrites = true;
      await uploadScenarioAsset("s1", "regionsGeojson", json({}), { refresh: false });
      assert.fail("the failed write should have thrown");
    }),
    /disk full/,
  );
  assert.equal(catalogReads(), 1, "the catalog shows what did land");
});

test("a batch returns what its writes returned", async () => {
  reset();
  const result = await withSingleLibraryRefresh(() => saveScenario("s1", {}, { refresh: false }));
  assert.deepEqual(result, { scenario: { id: "s1" } });
});
