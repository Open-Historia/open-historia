/*! Open Historia — downloading a hub scenario into a bundle © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubPosts.bundle.test.js
//
// What the game downloads of a hub scenario is always the checked copy in the
// hub's releases, never the post's own attachment, and only a download of the
// game's own says which post a scenario came from: a link written into a file
// (a scenario imported from disk, a map carried inside a game's zip) is
// dropped.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { zipBundle } from "./bundleZip.js";
import { readGameZip } from "./gameZip.js";
import { HUB_FILE_TEXTS, HUB_INDEX_URL } from "./hubFiles.js";
import { downloadHubBundle, downloadHubScenario } from "./hubPosts.js";

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
// Each file as its post names it, and its checked copy in the hub's releases.
const BASEMAP_URL = "https://github.com/user-attachments/assets/5f1a8b6c-shared-relief";
const BASEMAP_COPY = `${RELEASES}/basemaps-1/p7-5f1a8b6c.png`;
const POST_FILE_URL = "https://github.com/user-attachments/files/300/renamed-download";
const POST_FILE_COPY = `${RELEASES}/scenarios-1/p12-300-renamed-download-1b1b1b1b`;
const JSON_FILE_URL = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download/bundles/old-world.json";
const JSON_FILE_COPY = `${RELEASES}/scenarios-1/p7-39bff921-old-world-2c81beb2.json`;
const UNCHECKED_URL = "https://github.com/user-attachments/files/301/not-checked-yet.zip";

const INDEX = {
  version: 2,
  files: { [BASEMAP_URL]: BASEMAP_COPY, [POST_FILE_URL]: POST_FILE_COPY, [JSON_FILE_URL]: JSON_FILE_COPY },
  imports: {},
  posts: [],
  suggestions: {},
};
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

const scenario = (assets) => ({ schema: "open-historia-scenario-bundle/2", scenario: { name: "Shared Relief" }, data: { world: { background: { kind: "image" } } }, assets });
const zipBytes = async (entries) => new Uint8Array(await (await zipBundle(entries)).arrayBuffer());
const backgroundOf = (bundle) => JSON.parse(Buffer.from(bundle.assets.backgroundData.data, "base64").toString("utf-8"));
const communityRef = { mode: "communityRef", hash: "f".repeat(64), via: "image", url: BASEMAP_URL, fileName: "background.json" };

test("a hub download is its checked copy, and a zip whatever its address ends in", async () => {
  downloads.length = 0;
  files.set(POST_FILE_COPY, await zipBytes({ "scenario.json": JSON.stringify(scenario({})), "basemap.png": PNG_BYTES, "preview.jpg": PNG_BYTES }));
  const zipped = await downloadHubBundle(POST_FILE_URL);
  assert.equal(zipped.scenario.name, "Shared Relief");
  assert.deepEqual(backgroundOf(zipped), { dataUrl: PNG_DATA_URL }, "the basemap beside scenario.json is embedded again");

  const plain = scenario({ colors: { data: { Rome: [1, 2, 3] }, mode: "embedded" } });
  files.set(JSON_FILE_COPY, new TextEncoder().encode(JSON.stringify(plain)));
  assert.deepEqual(await downloadHubBundle(JSON_FILE_URL), plain, "a plain JSON bundle is read as JSON");
  assert.deepEqual(downloads, [POST_FILE_COPY, JSON_FILE_COPY], "neither post's own file is what is fetched");

  files.set(POST_FILE_COPY, await zipBytes({ "notes.txt": "hi" }));
  await assert.rejects(downloadHubBundle(POST_FILE_URL), /missing scenario\.json/);
});

test("a community basemap a scenario names is fetched from its checked copy, and one the hub does not offer is left out", async () => {
  downloads.length = 0;
  files.set(POST_FILE_COPY, await zipBytes({ "scenario.json": JSON.stringify(scenario({ backgroundData: communityRef })) }));
  const bundle = await downloadHubBundle(POST_FILE_URL);
  assert.deepEqual(backgroundOf(bundle), { dataUrl: PNG_DATA_URL }, "a PNG by its bytes, though GitHub serves a release file as a plain download");
  assert.deepEqual(downloads, [POST_FILE_COPY, BASEMAP_COPY], "the basemap's own attachment is not what is fetched");

  // Not among the hub's checked files: the scenario comes without it, and
  // nothing is fetched from the basemap's post instead.
  downloads.length = 0;
  files.set(POST_FILE_COPY, await zipBytes({ "scenario.json": JSON.stringify(scenario({ backgroundData: { ...communityRef, url: UNCHECKED_URL } })) }));
  const without = await downloadHubBundle(POST_FILE_URL);
  assert.equal(without.scenario.name, "Shared Relief");
  assert.equal(without.assets.backgroundData, undefined);
  assert.deepEqual(downloads, [POST_FILE_COPY]);
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
  // Downloaded: the link is the post the game asked for, not the one the file names.
  files.set(POST_FILE_COPY, await zipBytes({ "scenario.json": JSON.stringify(carrying) }));
  assert.equal((await downloadHubScenario({ postId: 12, bundleUrl: POST_FILE_URL })).hubOrigin.postId, 12);
  assert.equal((await downloadHubBundle(POST_FILE_URL)).hubOrigin, undefined);
  files.set(JSON_FILE_COPY, new TextEncoder().encode(JSON.stringify(carrying)));
  assert.equal((await downloadHubBundle(JSON_FILE_URL)).hubOrigin, undefined);

  // A map carried inside a game's zip is its sender's own.
  const game = await readGameZip(await zipBytes({ "game.json": JSON.stringify({ game: { name: "Campaign" } }), "scenario.json": JSON.stringify(carrying) }));
  assert.equal(game.scenarioBundle.scenario.name, "Shared Relief");
  assert.equal(game.scenarioBundle.hubOrigin, undefined);

  // A scenario imported from disk (the Scenarios tab's Import) is read in the
  // library itself, and drops the link before the store sees the bundle.
  const library = fs.readFileSync(new URL("../Game/GameUI/libraryBar.jsx", import.meta.url), "utf8");
  const fileImport = library.slice(library.indexOf("const handleImportScenarioFile = "), library.indexOf("// Full country name in the summary"));
  assert.match(fileImport, /if \(bundle && typeof bundle === "object"\) delete bundle\.hubOrigin;\s+const details = await importScenarioBundle\(bundle\);/);
  assert.equal(fileImport.match(/importScenarioBundle\(/g)?.length, 1);
});
