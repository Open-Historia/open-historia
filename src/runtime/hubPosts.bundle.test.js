/*! Open Historia — reading a scenario file into a bundle © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubPosts.bundle.test.js
//
// A hub scenario reaches the importer two ways: the game downloads the post's
// file, or the player downloads it by hand and imports it from disk. Both read
// it through readScenarioBundleBytes, so both come out the same — including
// the community basemap a published scenario references instead of carrying.
import test from "node:test";
import assert from "node:assert/strict";

import { zipBundle } from "./bundleZip.js";
import { splitBundleFiles } from "./bundleFiles.js";
import { downloadHubBundle, readScenarioBundleBytes, unpackScenarioBundle } from "./hubPosts.js";

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
const BASEMAP_URL = "https://github.com/user-attachments/assets/shared-relief.png";
const POST_FILE_URL = "https://github.com/user-attachments/files/300/renamed-download";

const files = new Map([[BASEMAP_URL, PNG_BYTES]]);
globalThis.fetch = async (input) => {
  const url = String(input);
  if (!url.startsWith("/api/hub/file?url=")) throw new Error(`unexpected fetch ${url}`);
  const file = files.get(decodeURIComponent(url.slice("/api/hub/file?url=".length)));
  if (!file) return Response.json({ error: "Not found on the hub." }, { status: 404 });
  return new Response(file, { headers: { "content-type": url.includes(".png") ? "image/png" : "application/octet-stream" } });
};

const scenario = (assets) => ({ schema: "pax-historia-scenario-bundle/2", scenario: { name: "Shared Relief" }, data: { world: { background: { kind: "image" } } }, assets });
const zipBytes = async (entries) => new Uint8Array(await (await zipBundle(entries)).arrayBuffer());
const backgroundOf = (bundle) => JSON.parse(Buffer.from(bundle.assets.backgroundData.data, "base64").toString("utf-8"));
const communityRef = { mode: "communityRef", hash: "f".repeat(64), via: "image", url: BASEMAP_URL, fileName: "background.json" };

test("a zip is read by its bytes: the basemap beside scenario.json is embedded again", async () => {
  const bytes = await zipBytes({ "scenario.json": JSON.stringify(scenario({})), "basemap.png": PNG_BYTES, "preview.jpg": PNG_BYTES });
  const bundle = await unpackScenarioBundle(bytes.buffer);
  assert.equal(bundle.assets.backgroundData.mode, "embedded");
  assert.deepEqual(backgroundOf(bundle), { dataUrl: PNG_DATA_URL });
});

test("a zip's lifted assets are put back, and a plain JSON bundle is read as JSON", async () => {
  const big = { type: "FeatureCollection", features: Array.from({ length: 2000 }, (_, index) => ({ type: "Feature", properties: { id: String(index) }, geometry: null })) };
  const lifted = splitBundleFiles(scenario({ regionsGeojson: { data: big, fileName: "regions.geojson", mode: "embedded" } }));
  assert.equal(lifted.bundle.assets.regionsGeojson.mode, "file");
  const bundle = await unpackScenarioBundle(await zipBytes({ ...lifted.files, "scenario.json": JSON.stringify(lifted.bundle) }));
  assert.deepEqual(bundle.assets.regionsGeojson.data, big);

  const plain = scenario({ colors: { data: { Rome: [1, 2, 3] }, mode: "embedded" } });
  assert.deepEqual(await unpackScenarioBundle(new TextEncoder().encode(JSON.stringify(plain))), plain);
  await assert.rejects(unpackScenarioBundle(await zipBytes({ "notes.txt": "hi" })), /missing scenario\.json/);
});

test("a post's .zip imported from disk fetches the community basemap it references", async () => {
  const bytes = await zipBytes({ "scenario.json": JSON.stringify(scenario({ backgroundData: communityRef })) });
  const bundle = await readScenarioBundleBytes(bytes.buffer);
  assert.equal(bundle.assets.backgroundData.mode, "embedded");
  assert.deepEqual(backgroundOf(bundle), { dataUrl: PNG_DATA_URL });
});

test("a hub download is a zip whatever its URL ends in", async () => {
  files.set(POST_FILE_URL, await zipBytes({ "scenario.json": JSON.stringify(scenario({ backgroundData: communityRef })) }));
  const bundle = await downloadHubBundle(POST_FILE_URL);
  assert.equal(bundle.scenario.name, "Shared Relief");
  assert.deepEqual(backgroundOf(bundle), { dataUrl: PNG_DATA_URL });
});
