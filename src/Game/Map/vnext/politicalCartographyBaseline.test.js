/*! Open Historia — beta political-cartography baseline guard © 2026 Open Historia contributors, AGPL-3.0-or-later. */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync(new URL("./polityBoundariesWorker.js", import.meta.url), "utf8");
const nations = fs.readFileSync(new URL("../Nations.jsx", import.meta.url), "utf8");

test("beta baseline keeps the experimental region display mesh out of the live worker graph", () => {
  assert.doesNotMatch(worker, /from ["']\.\/regionDisplayMesh\.js["']/);
  assert.doesNotMatch(worker, /buildRegionDisplayMeshBlob/);
  assert.doesNotMatch(worker, /scheduleDisplayMeshBuild/);
  assert.doesNotMatch(worker, /display-mesh-ready/);
});


test("political fills and province outlines are inserted below thick polity borders", () => {
  for (const layerId of [
    "regions-fill",
    "regions-outline",
    "custom-regions-fill",
    "ownership-transition-sweep-fill",
    "custom-regions-local-outline",
    "custom-regions-disputed-vnext",
  ]) {
    const start = nations.indexOf(`id="${layerId}"`);
    assert.ok(start >= 0, `missing ${layerId}`);
    const snippet = nations.slice(start, start + 700);
    assert.match(
      snippet,
      /beforeId=\{hasMapLayer\("polity-boundaries-shadow"\) \? "polity-boundaries-shadow" : undefined\}/,
      `${layerId} must stay below polity-boundaries-shadow when the border layer is already mounted`,
    );
  }

  // The low-zoom custom fallback has an extra stock-vector ordering constraint.
  const farStart = nations.indexOf('id="custom-regions-fill-far"');
  const farSnippet = nations.slice(farStart, farStart + 850);
  assert.match(farSnippet, /shouldMountStockRegions[\s\S]*?"regions-fill"[\s\S]*?"polity-boundaries-shadow"/);
});
