/*! Open Historia — community basemaps client tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/communityBasemaps.test.js
//
// The basemap browser reads the hub's posts, and a scenario that reuses a
// community basemap carries only a pointer to one of those posts' files. What
// has to hold, against a stubbed hub:
//   - every body shape a post can have (inline image, .svg attachment, zipped
//     vector, old .basemap.json, a scenario's .zip) is read as the right kind,
//     with the right file behind it;
//   - what is shown and what is downloaded is the file's checked copy in the
//     hub's releases, never the post's own attachment, and a post whose file
//     has no copy is not offered;
//   - install and publish-time dedupe point a reference at the same file, read
//     the same way;
//   - a reference resolves back into the basemap it was made from, and one the
//     hub does not offer leaves the scenario without its basemap.
import test from "node:test";
import assert from "node:assert/strict";

import { zipBundle } from "./bundleZip.js";
import {
  basemapPostInstallable,
  dedupeScenarioBundleBackground,
  fetchCommunityBasemaps,
  installCommunityBasemap,
  resolveScenarioBundleBackground,
} from "./communityBasemaps.js";
import { sha256Hex } from "./basemapLibrary.js";
import { HUB_INDEX_URL } from "./hubFiles.js";

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
const VECTOR = { type: "FeatureCollection", features: [{ type: "Feature", properties: { fill: "#123456" }, geometry: { type: "Point", coordinates: [1, 2] } }] };

const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
// Each file as its post names it...
const INLINE_URL = "https://github.com/user-attachments/assets/aaaa-inline.png";
const SVG_URL = "https://github.com/user-attachments/files/101/coast.svg";
const ZIP_URL = "https://github.com/user-attachments/files/102/vector-world.zip";
const OLD_JSON_URL = `${RELEASES}/b1/old.basemap.json`;
const SCENARIO_ZIP_URL = "https://github.com/user-attachments/files/103/rome-scenario.zip";
const AGAIN_ZIP_URL = "https://github.com/user-attachments/files/104/again.zip";
const LOST_URL = "https://github.com/user-attachments/assets/lost.png";
const UNCHECKED_URL = "https://github.com/user-attachments/assets/unchecked.png";
// ...and its checked copy in the hub's releases. An .svg's copy is a PNG: the
// hub draws one of every SVG it is given.
const COPIES = {
  [INLINE_URL]: `${RELEASES}/basemaps-1/p1-aaaa-0a0a0a0a.png`,
  [SVG_URL]: `${RELEASES}/basemaps-1/p2-101-coast-1b1b1b1b.png`,
  [ZIP_URL]: `${RELEASES}/basemaps-1/p3-102-vector-world-2c2c2c2c.zip`,
  [OLD_JSON_URL]: `${RELEASES}/basemaps-1/p4-old-3d3d3d3d.basemap.json`,
  [SCENARIO_ZIP_URL]: `${RELEASES}/scenarios-1/p10-103-rome-scenario-4e4e4e4e.zip`,
  [AGAIN_ZIP_URL]: `${RELEASES}/scenarios-1/p11-104-again-5f5f5f5f.zip`,
  // Listed, and no longer there to download.
  [LOST_URL]: `${RELEASES}/basemaps-1/p7-lost-7b7b7b7b.png`,
};

const issue = (number, title, body, extra = {}) => ({
  number,
  title,
  body,
  user: { login: `author${number}`, avatar_url: "" },
  html_url: `https://github.com/Open-Historia/Open-historia-scenarios/issues/${number}`,
  created_at: "2026-09-01T00:00:00Z",
  author_association: "NONE",
  reactions: { "+1": number },
  ...extra,
});

// Every file the stubbed hub serves, by its address; every download is recorded.
const files = new Map();
const downloads = [];
const fetched = [];
let basemapIssues = [];
let scenarioIssues = [];
let localBasemaps = [];
const saved = [];

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === HUB_INDEX_URL) {
    fetched.push(url);
    return Response.json({
      version: 2,
      files: COPIES,
      imports: {},
      posts: [...basemapIssues.map((entry) => ({ ...entry, kind: "basemap" })), ...scenarioIssues.map((entry) => ({ ...entry, kind: "scenario" }))],
      suggestions: {},
    });
  }
  if (url === "/api/basemaps" && (init.method ?? "GET") === "GET") return Response.json(localBasemaps);
  if (url === "/api/basemaps" && init.method === "POST") {
    const body = JSON.parse(init.body);
    saved.push(body);
    return Response.json({ id: `bm-${saved.length}`, ...body });
  }
  if (url.startsWith("/api/hub/file?url=")) {
    const target = decodeURIComponent(url.slice("/api/hub/file?url=".length));
    downloads.push(target);
    const file = files.get(target);
    if (!file) return Response.json({ error: "Not found on the hub." }, { status: 404 });
    return new Response(file.bytes, { headers: { "content-type": file.type } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const zipBytes = async (entries) => new Uint8Array(await (await zipBundle(entries)).arrayBuffer());
// As GitHub serves a release file, whatever it is.
const RELEASE_TYPE = "application/octet-stream";

const setUpHub = async () => {
  files.set(COPIES[INLINE_URL], { bytes: PNG_BYTES, type: RELEASE_TYPE });
  files.set(COPIES[SVG_URL], { bytes: PNG_BYTES, type: RELEASE_TYPE });
  files.set(COPIES[ZIP_URL], { bytes: await zipBytes({ "basemap.geojson": JSON.stringify(VECTOR) }), type: RELEASE_TYPE });
  files.set(COPIES[OLD_JSON_URL], {
    bytes: new TextEncoder().encode(JSON.stringify({ basemap: { name: "Old Map", kind: "image" }, payload: { dataUrl: PNG_DATA_URL } })),
    type: RELEASE_TYPE,
  });
  files.set(COPIES[SCENARIO_ZIP_URL], { bytes: await zipBytes({ "scenario.json": "{}", "basemap.png": PNG_BYTES, "preview.jpg": PNG_BYTES }), type: RELEASE_TYPE });
  // The attachments themselves, so a test can see that nothing asks for one.
  files.set(INLINE_URL, { bytes: PNG_BYTES, type: "image/png" });
  files.set(UNCHECKED_URL, { bytes: PNG_BYTES, type: "image/png" });

  basemapIssues = [
    issue(1, "[Basemap] Inline Relief", `### Image\n![relief](${INLINE_URL})\n\n### Basemap info\nBasemap-Hash: ${"a".repeat(64)}\nBasemap-Kind: image`),
    // Closed by the hub once its file was released: still a post.
    issue(2, "[Basemap] Coast Lines", `### Image\n[coast.svg](${SVG_URL})\n\nBasemap-Hash: ${"b".repeat(64)}\nBasemap-Kind: image`, { state: "closed" }),
    issue(3, "[Basemap] Vector World", `### File\n[vector-world.zip](${ZIP_URL})\n\nBasemap-Hash: ${"c".repeat(64)}\nBasemap-Kind: vector`),
    issue(4, "Old Map", `Bundle file: ${OLD_JSON_URL}\nBasemap-Hash: ${"d".repeat(64)}`),
    issue(5, "[Basemap] Not among the checked files", `### Image\n![x](${UNCHECKED_URL})\nBasemap-Kind: image`),
  ];
  scenarioIssues = [
    issue(10, "[Scenario] Rome", `### Scenario file\n[rome-scenario.zip](${SCENARIO_ZIP_URL})\n\nBasemap-Hash: ${"e".repeat(64)}\nBasemap-Kind: image`),
    // Carries the same basemap as post 1, so it is listed once, as post 1.
    issue(11, "[Scenario] Relief Again", `[again.zip](${AGAIN_ZIP_URL})\nBasemap-Hash: ${"a".repeat(64)}`),
    issue(12, "[Scenario] Plain JSON", "https://github.com/user-attachments/files/105/plain.json"),
    issue(13, "[Scenario] Not among the checked files", "[later.zip](https://github.com/user-attachments/files/106/later.zip)"),
  ];
  return fetchCommunityBasemaps({ force: true });
};

const byId = (posts, id) => posts.find((post) => post.id === id);

test("every body shape is read as the right kind of post, with the right file", async () => {
  fetched.length = 0;
  const posts = await setUpHub();
  assert.deepEqual(fetched, [HUB_INDEX_URL], "one read of the hub's index, and no request to GitHub's API");
  assert.deepEqual(posts.map((post) => post.id), [1, 2, 3, 4, "scenario-10"], "a post whose file the hub has not released is not offered");

  const inline = byId(posts, 1);
  assert.equal(inline.title, "Inline Relief");
  assert.equal(inline.kind, "image");
  assert.equal(inline.coverImageUrl, INLINE_URL);
  assert.equal(inline.pictureUrl, COPIES[INLINE_URL], "the card shows the image's checked copy");
  assert.equal(inline.bundleUrl, null);
  assert.equal(inline.contentHash, "a".repeat(64));

  const svg = byId(posts, 2);
  assert.equal(svg.bundleUrl, SVG_URL);
  assert.equal(svg.kind, "image");
  assert.equal(svg.pictureUrl, null, "an attached .svg was never the card's picture");

  const vector = byId(posts, 3);
  assert.equal(vector.kind, "vector");
  assert.equal(vector.bundleUrl, ZIP_URL);
  assert.equal(vector.pictureUrl, null);

  const old = byId(posts, 4);
  assert.equal(old.title, "Old Map");
  assert.equal(old.bundleUrl, OLD_JSON_URL);

  const fromScenario = byId(posts, "scenario-10");
  assert.equal(fromScenario.fromScenario, true);
  assert.equal(fromScenario.scenarioZipUrl, SCENARIO_ZIP_URL);
  assert.equal(fromScenario.title, "Rome (basemap)");

  for (const post of posts) assert.equal(basemapPostInstallable(post), true, `post ${post.id} is installable`);
  assert.equal(basemapPostInstallable({ kind: "vector", coverImageUrl: INLINE_URL }), false, "a vector needs its data file");
});

test("install reads each post's payload from its checked copy, and records the file a reference should point at", async () => {
  const posts = await setUpHub();
  saved.length = 0;
  downloads.length = 0;
  const cases = [
    { id: 1, kind: "image", payloadUrl: INLINE_URL, payloadVia: "image" },
    { id: 2, kind: "image", payloadUrl: SVG_URL, payloadVia: "image" },
    { id: 3, kind: "vector", payloadUrl: ZIP_URL, payloadVia: "dataFile" },
    { id: 4, kind: "image", payloadUrl: OLD_JSON_URL, payloadVia: "dataFile" },
  ];
  for (const expected of cases) {
    await installCommunityBasemap(byId(posts, expected.id));
    const body = saved.at(-1);
    assert.equal(body.kind, expected.kind, `post ${expected.id} kind`);
    assert.equal(body.source.payloadUrl, expected.payloadUrl, `post ${expected.id} payload url`);
    assert.equal(body.source.payloadVia, expected.payloadVia, `post ${expected.id} payload via`);
  }
  assert.deepEqual(saved[2].payload, { geojson: VECTOR }, "the zipped vector unpacks to its geometry");
  assert.equal(saved[3].name, "Old Map", "an old bundle's own name wins");
  assert.equal(saved[0].payload.dataUrl, PNG_DATA_URL, "a PNG by its bytes, though GitHub serves a release file as a plain download");
  assert.equal(saved[1].payload.dataUrl, PNG_DATA_URL, "the .svg's copy is the PNG the hub drew of it, and is saved as one");

  await installCommunityBasemap(byId(posts, "scenario-10"));
  assert.equal(saved.at(-1).payload.dataUrl, PNG_DATA_URL, "a scenario's basemap.png, not its preview");
  assert.deepEqual(
    downloads,
    [COPIES[INLINE_URL], COPIES[SVG_URL], COPIES[ZIP_URL], COPIES[OLD_JSON_URL], COPIES[SCENARIO_ZIP_URL]],
    "every download is a checked copy; no post's own attachment is fetched",
  );
});

// A scenario bundle whose background is embedded the way the exporter writes it.
const bundleWith = (kind, payload) => ({
  assets: {
    backgroundData: {
      mode: "embedded",
      data: Buffer.from(JSON.stringify(payload), "utf-8").toString("base64"),
      fileName: "background.json",
      contentType: "application/json",
    },
  },
  data: { world: { background: { kind } } },
});

test("dedupe prefers a local community install, then a hub post, and otherwise asks to publish", async () => {
  await setUpHub();
  const vectorHash = await sha256Hex(JSON.stringify(VECTOR));
  basemapIssues[2] = issue(3, "[Basemap] Vector World", `[vector-world.zip](${ZIP_URL})\nBasemap-Hash: ${vectorHash}\nBasemap-Kind: vector`);
  await fetchCommunityBasemaps({ force: true });

  // Local hit: no hub search needed, and the reference is the recorded file.
  localBasemaps = [{ contentHash: vectorHash, source: { community: true, payloadUrl: ZIP_URL, payloadVia: "dataFile" } }];
  const local = bundleWith("vector", { geojson: VECTOR });
  assert.deepEqual(await dedupeScenarioBundleBackground(local), { referenced: true, needsPublish: false });
  assert.deepEqual(local.assets.backgroundData, { mode: "communityRef", hash: vectorHash, via: "dataFile", url: ZIP_URL, fileName: "background.json" });

  // Hub hit: the same reference, found through the post list. It names the
  // file as its post does, never the copy: the copy is looked up when the
  // reference is resolved.
  localBasemaps = [];
  const hub = bundleWith("vector", { geojson: VECTOR });
  assert.deepEqual(await dedupeScenarioBundleBackground(hub), { referenced: true, needsPublish: false });
  assert.deepEqual(hub.assets.backgroundData, local.assets.backgroundData, "local and hub references are identical");

  // No hit: left embedded.
  const other = bundleWith("image", { dataUrl: "data:image/png;base64,AAAA" });
  const before = structuredClone(other.assets.backgroundData);
  assert.deepEqual(await dedupeScenarioBundleBackground(other), { referenced: false, needsPublish: true });
  assert.deepEqual(other.assets.backgroundData, before);
});

const embeddedPayload = (bundle) => JSON.parse(Buffer.from(bundle.assets.backgroundData.data, "base64").toString("utf-8"));

test("a reference resolves back into the basemap it was made from, fetched from its checked copy", async () => {
  await setUpHub();
  const ref = (via, url) => ({ assets: { backgroundData: { mode: "communityRef", hash: "x", via, url, fileName: "background.json" } } });
  downloads.length = 0;

  const image = await resolveScenarioBundleBackground(ref("image", INLINE_URL));
  assert.equal(image.assets.backgroundData.mode, "embedded");
  assert.deepEqual(embeddedPayload(image), { dataUrl: PNG_DATA_URL });

  const old = await resolveScenarioBundleBackground(ref("dataFile", OLD_JSON_URL));
  assert.deepEqual(embeddedPayload(old), { dataUrl: PNG_DATA_URL });

  // Written before `via` existed: the kind decides.
  const legacy = await resolveScenarioBundleBackground({ assets: { backgroundData: { mode: "communityRef", kind: "image", url: INLINE_URL } } });
  assert.deepEqual(embeddedPayload(legacy), { dataUrl: PNG_DATA_URL });

  // A reference that names the checked copy itself is fetched from it too.
  const byCopy = await resolveScenarioBundleBackground(ref("image", COPIES[INLINE_URL]));
  assert.deepEqual(embeddedPayload(byCopy), { dataUrl: PNG_DATA_URL });
  assert.deepEqual(downloads, [COPIES[INLINE_URL], COPIES[OLD_JSON_URL], COPIES[INLINE_URL], COPIES[INLINE_URL]]);
});

test("a reference the hub does not offer, or that will not download, leaves the scenario without its basemap", async () => {
  await setUpHub();
  // Not among the hub's checked files: nothing is fetched from the post instead.
  downloads.length = 0;
  const refused = await resolveScenarioBundleBackground({ assets: { backgroundData: { mode: "communityRef", hash: "x", via: "image", url: UNCHECKED_URL, fileName: "background.json" } } });
  assert.equal(refused.assets.backgroundData, undefined);
  assert.deepEqual(downloads, []);

  // The hub lists a copy that will not download.
  const gone = await resolveScenarioBundleBackground({ assets: { backgroundData: { mode: "communityRef", hash: "x", via: "image", url: LOST_URL, fileName: "background.json" } } });
  assert.equal(gone.assets.backgroundData, undefined);
  assert.deepEqual(downloads, [COPIES[LOST_URL]], "its copy was tried, and its attachment was not");
});
