/*! Open Historia — reading a scenario file into a bundle © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubPosts.bundle.test.js
//
// A hub scenario reaches the importer two ways: the game downloads the post's
// file, or the player downloads it by hand and imports it from disk. Both read
// it through readScenarioBundleBytes, so both come out the same — including
// the community basemap a published scenario references instead of carrying.
// What the game downloads is always the checked copy in the hub's releases,
// and only a download of its own says which post a scenario came from.
import test from "node:test";
import assert from "node:assert/strict";

import { zipBundle } from "./bundleZip.js";
import { splitBundleFiles } from "./bundleFiles.js";
import { unresolvedBundleBackground } from "./communityBasemaps.js";
import { HUB_FILE_TEXTS, HUB_INDEX_URL } from "./hubFiles.js";
import { downloadHubBundle, downloadHubScenario, readScenarioBundleBytes, unpackScenarioBundle } from "./hubPosts.js";

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
// Each file as its post names it, and its checked copy in the hub's releases.
const BASEMAP_URL = "https://github.com/user-attachments/assets/shared-relief.png";
const BASEMAP_COPY = `${RELEASES}/basemaps-1/p7-shared-relief-0a0a0a0a.png`;
const POST_FILE_URL = "https://github.com/user-attachments/files/300/renamed-download";
const POST_FILE_COPY = `${RELEASES}/scenarios-1/p12-300-renamed-download-1b1b1b1b`;
const UNCHECKED_URL = "https://github.com/user-attachments/files/301/not-checked-yet.zip";

const INDEX = { version: 2, files: { [BASEMAP_URL]: BASEMAP_COPY, [POST_FILE_URL]: POST_FILE_COPY }, imports: {}, posts: [], suggestions: {} };
// What the stubbed hub serves, by address. The attachments are there too, so
// a test can see that nothing asks for one.
const files = new Map([[BASEMAP_COPY, PNG_BYTES], [BASEMAP_URL, PNG_BYTES], [UNCHECKED_URL, PNG_BYTES]]);
const downloads = [];
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === HUB_INDEX_URL) return Response.json(INDEX);
  if (!url.startsWith("/api/hub/file?url=")) throw new Error(`unexpected fetch ${url}`);
  const target = decodeURIComponent(url.slice("/api/hub/file?url=".length));
  downloads.push(target);
  const file = files.get(target);
  if (!file) return Response.json({ error: "Not found on the hub." }, { status: 404 });
  // As GitHub serves a release file, whatever it is.
  return new Response(file, { headers: { "content-type": "application/octet-stream" } });
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

test("a post's .zip imported from disk fetches the community basemap it references, from its checked copy", async () => {
  downloads.length = 0;
  const bytes = await zipBytes({ "scenario.json": JSON.stringify(scenario({ backgroundData: communityRef })) });
  const bundle = await readScenarioBundleBytes(bytes.buffer);
  assert.equal(bundle.assets.backgroundData.mode, "embedded");
  assert.deepEqual(backgroundOf(bundle), { dataUrl: PNG_DATA_URL }, "a PNG by its bytes, though GitHub serves a release file as a plain download");
  assert.deepEqual(downloads, [BASEMAP_COPY], "the basemap's own attachment is not what is fetched");
});

test("a community basemap the hub does not offer leaves the scenario without it, and says why", async () => {
  downloads.length = 0;
  const reference = { ...communityRef, url: UNCHECKED_URL };
  const bundle = await readScenarioBundleBytes(new TextEncoder().encode(JSON.stringify(scenario({ backgroundData: reference }))));
  assert.equal(bundle.assets.backgroundData.mode, "communityRef", "kept as its reference, for a later try");
  assert.equal(unresolvedBundleBackground(bundle), HUB_FILE_TEXTS.notReleased);
  assert.deepEqual(downloads, [], "nothing is fetched from the post instead");
});

test("a hub download is a zip whatever its URL ends in", async () => {
  downloads.length = 0;
  files.set(POST_FILE_COPY, await zipBytes({ "scenario.json": JSON.stringify(scenario({ backgroundData: communityRef })) }));
  const bundle = await downloadHubBundle(POST_FILE_URL);
  assert.equal(bundle.scenario.name, "Shared Relief");
  assert.deepEqual(backgroundOf(bundle), { dataUrl: PNG_DATA_URL });
  assert.deepEqual(downloads, [POST_FILE_COPY, BASEMAP_COPY]);
});

test("a download is stamped with its post, its file and the checked copy that was downloaded", async () => {
  downloads.length = 0;
  files.set(POST_FILE_COPY, await zipBytes({ "scenario.json": JSON.stringify(scenario({})) }));
  const bundle = await downloadHubScenario({ postId: 12, bundleUrl: POST_FILE_URL, title: "Shared Relief", author: "ann" });
  assert.deepEqual(bundle.hubOrigin, { postId: 12, bundleUrl: POST_FILE_URL, release: POST_FILE_COPY, title: "Shared Relief", author: "ann" });
  assert.deepEqual(downloads, [POST_FILE_COPY]);
  // Import & play hands on the sender's own date and knows no title.
  const forGame = await downloadHubScenario({ postId: 12, bundleUrl: POST_FILE_URL, syncedAt: "2026-08-01T00:00:00.000Z" });
  assert.deepEqual(forGame.hubOrigin, { postId: 12, bundleUrl: POST_FILE_URL, release: POST_FILE_COPY, syncedAt: "2026-08-01T00:00:00.000Z" });
});

test("a file the hub has not released is not downloaded: the import fails with a sentence", async () => {
  downloads.length = 0;
  await assert.rejects(downloadHubScenario({ postId: 13, bundleUrl: UNCHECKED_URL }), { message: HUB_FILE_TEXTS.notReleased });
  await assert.rejects(downloadHubBundle(UNCHECKED_URL), { message: HUB_FILE_TEXTS.notReleased });
  assert.deepEqual(downloads, []);
});

test("a file never brings its own link to a post: only a download of the game's own stamps one", async () => {
  const forged = { postId: 99, bundleUrl: POST_FILE_URL, release: POST_FILE_COPY };
  const carrying = { ...scenario({}), hubOrigin: forged };
  // Imported from disk, as JSON or as a zip.
  assert.equal((await readScenarioBundleBytes(new TextEncoder().encode(JSON.stringify(carrying)))).hubOrigin, undefined);
  assert.equal((await readScenarioBundleBytes(await zipBytes({ "scenario.json": JSON.stringify(carrying) }))).hubOrigin, undefined);
  // Downloaded: the link is the post the game asked for, not the one the file names.
  files.set(POST_FILE_COPY, await zipBytes({ "scenario.json": JSON.stringify(carrying) }));
  assert.equal((await downloadHubScenario({ postId: 12, bundleUrl: POST_FILE_URL })).hubOrigin.postId, 12);
  assert.equal((await downloadHubBundle(POST_FILE_URL)).hubOrigin, undefined);
});
