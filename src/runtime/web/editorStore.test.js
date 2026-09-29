/*! Open Historia — web-mode map-editor store tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/editorStore.test.js
//
// The Documents menu on the website and on Android lists every saved Workshop
// map, and a saved map can be tens of MB. The list must come from the summary
// index, never from loading the maps themselves.

import assert from "node:assert/strict";
import test from "node:test";

import { installFakeIndexedDb } from "./fakeIndexedDb.js";

const fake = installFakeIndexedDb();
const { STORES } = await import("./idb.js");
const { handleMapEditor } = await import("./editorStore.js");

const DB = "open-historia-web";
const call = async (method, id, body) => {
  const segments = id ? ["documents", encodeURIComponent(id)] : ["documents"];
  const response = await handleMapEditor({ method, segments, body });
  return { status: response.status, body: await response.json() };
};
const list = async () => (await call("GET")).body;
const polygon = (id) => ({ type: "Feature", id, properties: { id }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });

test("saving a document writes its summary beside it, and the list is built from the summaries", async () => {
  fake.clear();
  const created = await call("POST", null, { name: "Old World", regions: { type: "FeatureCollection", features: [polygon("a"), polygon("b")] } });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, "old-world");
  assert.equal(created.body.regionCount, 2);

  const summaries = fake.rows(DB, STORES.mapeditorMeta);
  assert.deepEqual([...summaries.keys()], ["old-world"]);
  assert.equal(summaries.get("old-world").regions, undefined, "the summary never carries the map");

  // Tamper with the stored document behind the index's back: the list still
  // answers from the summary, so it never read the document.
  const docs = fake.rows(DB, STORES.mapeditorDocs);
  docs.set("old-world", { ...docs.get("old-world"), name: "Changed behind the index" });
  assert.deepEqual((await list()).map((d) => d.name), ["Old World"]);
});

test("an update refreshes the summary, and a delete removes both rows", async () => {
  fake.clear();
  await call("POST", null, { name: "Map" });
  const updated = await call("PUT", "map", { name: "Renamed", regions: { type: "FeatureCollection", features: [polygon("x")] } });
  assert.equal(updated.body.name, "Renamed");
  const [summary] = await list();
  assert.equal(summary.name, "Renamed");
  assert.equal(summary.regionCount, 1);

  const removed = await call("DELETE", "map");
  assert.deepEqual(removed.body, { id: "map", deleted: true });
  assert.equal(fake.rows(DB, STORES.mapeditorDocs).size, 0);
  assert.equal(fake.rows(DB, STORES.mapeditorMeta).size, 0);
  assert.deepEqual(await list(), []);
});

test("documents saved before the index existed are summarised once, and stray summaries are dropped", async () => {
  fake.clear();
  // A document from before the upgrade: in the document store with no summary.
  fake.rows(DB, STORES.mapeditorDocs).set("legacy", {
    id: "legacy", name: "Legacy map", metadata: { kind: "hand-drawn" },
    regions: { type: "FeatureCollection", features: [polygon("r")] }, features: [], types: [],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  });
  // A summary whose document is gone.
  fake.rows(DB, STORES.mapeditorMeta).set("ghost", { id: "ghost", name: "Ghost" });

  assert.deepEqual(await list(), [{
    id: "legacy", name: "Legacy map", kind: "hand-drawn", regionCount: 1, featureCount: 0, typeCount: 0,
    updatedAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
  }]);
  assert.deepEqual([...fake.rows(DB, STORES.mapeditorMeta).keys()], ["legacy"]);
});

test("the list keeps the manifest order, newest first, with unlisted documents after", async () => {
  fake.clear();
  await call("POST", null, { name: "First" });
  await call("POST", null, { name: "Second" });
  fake.rows(DB, STORES.mapeditorDocs).set("aaa-stray", { id: "aaa-stray", name: "Stray" });
  assert.deepEqual((await list()).map((d) => d.id), ["second", "first", "aaa-stray"]);
});

test("a new document never takes an existing id", async () => {
  fake.clear();
  await call("POST", null, { name: "Europe" });
  const again = await call("POST", null, { name: "Europe" });
  assert.equal(again.body.id, "europe-2");
  assert.deepEqual((await list()).map((d) => d.id), ["europe-2", "europe"]);
});
