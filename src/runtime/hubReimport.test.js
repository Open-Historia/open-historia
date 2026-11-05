/*! Open Historia — importing a hub post again is not an import © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubReimport.test.js
//
// The hub counts a post's imports by the downloads of its checked copy. A post
// this player has imported before (still in the library or deleted since) is
// downloaded from the copy's update copy, which the hub does not count. Which
// posts were imported is kept by post number in ui-settings (hubImported).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { installFakeIndexedDb } from "./web/fakeIndexedDb.js";
import { zipBundle } from "./bundleZip.js";
import { HUB_INDEX_URL } from "./hubFiles.js";
import { HUB_IMPORTED_KEY, MAX_HUB_IMPORTED, hubImportedIncludes, mergeHubImported, normalizeHubImported } from "../../server/hubImported.js";

installFakeIndexedDb();
const { handleUiSettings } = await import("./web/settingsStore.js");
const { downloadHubScenario, hubPostImportedBefore } = await import("./hubPosts.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
const FILE = (n) => `https://github.com/user-attachments/files/${n}/scenario.zip`;
const COPY = (n) => `${RELEASES}/scenarios-1/p${n}-scenario-1a1a1a1a.zip`;
const UPDATE = (n) => `${RELEASES}/scenarios-1/p${n}-scenario-1a1a1a1a-update.zip`;
// Posts 1-3 have update copies; post 4 has none yet (the hub backfills them a
// few at a time).
const INDEX = {
  version: 2,
  files: { [FILE(1)]: COPY(1), [FILE(2)]: COPY(2), [FILE(3)]: COPY(3), [FILE(4)]: COPY(4) },
  imports: {},
  posts: [],
  suggestions: {},
  updates: { [COPY(1)]: UPDATE(1), [COPY(2)]: UPDATE(2), [COPY(3)]: UPDATE(3) },
};

const zip = new Uint8Array(await (await zipBundle({ "scenario.json": JSON.stringify({ schema: "pax-historia-scenario-bundle/2", scenario: { name: "S" }, data: {}, assets: {} }) })).arrayBuffer());
const downloads = [];
// ui-settings is answered by the website's own store (settingsStore.js), which
// keeps it as the desktop server does.
let settingsWorks = true;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === HUB_INDEX_URL) return Response.json(INDEX);
  if (url === "/api/ui-settings") {
    if (!settingsWorks) throw new TypeError("Failed to fetch");
    const method = init.method ?? "GET";
    return handleUiSettings({ method, body: init.body ? JSON.parse(init.body) : null });
  }
  if (!url.startsWith("/api/hub/file?url=")) throw new Error(`unexpected fetch ${url}`);
  downloads.push(decodeURIComponent(url.slice("/api/hub/file?url=".length)));
  return new Response(zip, { headers: { "content-type": "application/octet-stream" } });
};
const take = () => downloads.splice(0);

test("the first import of a post downloads the counted copy; every later one the update copy", async () => {
  await downloadHubScenario({ postId: 1, bundleUrl: FILE(1) });
  assert.deepEqual(take(), [COPY(1)], "a first import counts");
  assert.equal(await hubPostImportedBefore(1), true);
  // Imported again: the scenario was deleted, or the player imports a second copy.
  const again = await downloadHubScenario({ postId: 1, bundleUrl: FILE(1) });
  assert.deepEqual(take(), [UPDATE(1)], "importing again does not count");
  assert.equal(again.hubOrigin.release, COPY(1), "the link still names the checked copy");
});

test("a post the library already holds is not counted again, and an Update never is", async () => {
  await downloadHubScenario({ postId: 2, bundleUrl: FILE(2), again: true });
  assert.deepEqual(take(), [UPDATE(2)]);
  await downloadHubScenario({ postId: 3, bundleUrl: FILE(3), update: true });
  assert.deepEqual(take(), [UPDATE(3)]);
  assert.equal(await hubPostImportedBefore(2), true, "both are remembered from then on");
  assert.equal(await hubPostImportedBefore(3), true);
});

test("a post with no update copy yet falls back to the counted copy", async () => {
  await downloadHubScenario({ postId: 4, bundleUrl: FILE(4) });
  await downloadHubScenario({ postId: 4, bundleUrl: FILE(4) });
  assert.deepEqual(take(), [COPY(4), COPY(4)]);
});

test("with no record to read, an import downloads the counted copy as it always did", async () => {
  settingsWorks = false;
  try {
    assert.equal(await hubPostImportedBefore(1), false);
    const bundle = await downloadHubScenario({ postId: 1, bundleUrl: FILE(1) });
    assert.equal(bundle.hubOrigin.postId, 1, "the import itself goes on");
    assert.deepEqual(take(), [COPY(1)]);
  } finally {
    settingsWorks = true;
  }
});

test("the record keeps post numbers only, is added to and never replaced, and keeps the language", async () => {
  await handleUiSettings({ method: "PUT", body: { language: "de" } });
  await handleUiSettings({ method: "PUT", body: { [HUB_IMPORTED_KEY]: [9, "10", -1, "x", 1.5, { id: 2 }] } });
  const stored = await (await handleUiSettings({ method: "GET" })).json();
  assert.equal(stored.language, "de");
  assert.deepEqual(stored[HUB_IMPORTED_KEY], [1, 2, 3, 4, 9, 10]);
  await handleUiSettings({ method: "PUT", body: { [HUB_IMPORTED_KEY]: [] } });
  assert.deepEqual((await (await handleUiSettings({ method: "GET" })).json())[HUB_IMPORTED_KEY], [1, 2, 3, 4, 9, 10]);

  assert.deepEqual(normalizeHubImported("1,2"), []);
  assert.deepEqual(mergeHubImported([3, 1], [1, 2]), [3, 1, 2]);
  const full = Array.from({ length: MAX_HUB_IMPORTED }, (_, index) => index + 1);
  assert.deepEqual(mergeHubImported(full, [MAX_HUB_IMPORTED + 1]).slice(0, 1), [2], "the oldest goes first");
  assert.equal(hubImportedIncludes([5], "5"), true);
  assert.equal(hubImportedIncludes([5], 6), false);
});

test("the desktop server keeps the record the same way, and the Community tab says when the library holds the post", () => {
  const server = fs.readFileSync(path.join(ROOT, "server/server.js"), "utf8");
  assert.match(server, /app\.put\("\/api\/ui-settings"[\s\S]{0,600}?next\[HUB_IMPORTED_KEY\] = mergeHubImported\(next\[HUB_IMPORTED_KEY\], req\.body\[HUB_IMPORTED_KEY\]\)/);
  const hub = fs.readFileSync(path.join(ROOT, "src/Game/GameUI/communityHub.jsx"), "utf8");
  assert.ok(hub.includes("again: Boolean(libraryOf(post).status)"));
});
