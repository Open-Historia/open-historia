/*! Open Historia — community basemaps client tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/communityBasemaps.test.js
//
// The basemap browser reads GitHub issue bodies, and a scenario that reuses a
// community basemap carries only a pointer to one of those posts' files. What
// has to hold, against a stubbed hub:
//   - every body shape a post can have (inline image, .svg attachment, zipped
//     vector, old .basemap.json, a scenario's .zip) is read as the right kind,
//     with the right file behind it;
//   - install and publish-time dedupe point a reference at the same file, read
//     the same way;
//   - a reference resolves back into the basemap it was made from — including a
//     vector published as a .zip, which used to be parsed as JSON and dropped.
import test from "node:test";
import assert from "node:assert/strict";

import { zipBundle } from "./bundleZip.js";
import {
  basemapPostInstallable,
  dedupeScenarioBundleBackground,
  fetchCommunityBasemaps,
  installCommunityBasemap,
  resolveScenarioBundleBackground,
  unresolvedBundleBackground,
} from "./communityBasemaps.js";
import { sha256Hex } from "./basemapLibrary.js";

const ISSUES_BASEMAPS = /issues\?state=open&labels=basemap/;
const ISSUES_SCENARIOS = /issues\?state=open&labels=scenario/;
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
const VECTOR = { type: "FeatureCollection", features: [{ type: "Feature", properties: { fill: "#123456" }, geometry: { type: "Point", coordinates: [1, 2] } }] };

const INLINE_URL = "https://github.com/user-attachments/assets/aaaa-inline.png";
const SVG_URL = "https://github.com/user-attachments/files/101/coast.svg";
const ZIP_URL = "https://github.com/user-attachments/files/102/vector-world.zip";
const OLD_JSON_URL = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download/b1/old.basemap.json";
const SCENARIO_ZIP_URL = "https://github.com/user-attachments/files/103/rome-scenario.zip";

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

// Every file the stubbed hub serves, by the URL the post links.
const files = new Map();
let basemapIssues = [];
let scenarioIssues = [];
let localBasemaps = [];
const saved = [];

const hubFile = (url) => files.get(url);

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (ISSUES_BASEMAPS.test(url)) return Response.json(basemapIssues);
  if (ISSUES_SCENARIOS.test(url)) return Response.json(scenarioIssues);
  if (url === "/api/basemaps" && (init.method ?? "GET") === "GET") return Response.json(localBasemaps);
  if (url === "/api/basemaps" && init.method === "POST") {
    const body = JSON.parse(init.body);
    saved.push(body);
    return Response.json({ id: `bm-${saved.length}`, ...body });
  }
  if (url.startsWith("/api/hub/file?url=")) {
    const target = decodeURIComponent(url.slice("/api/hub/file?url=".length));
    const file = hubFile(target);
    if (!file) return Response.json({ error: "Not found on the hub." }, { status: 404 });
    return new Response(file.bytes, { headers: { "content-type": file.type } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const zipBytes = async (entries) => new Uint8Array(await (await zipBundle(entries)).arrayBuffer());

const setUpHub = async () => {
  files.set(INLINE_URL, { bytes: PNG_BYTES, type: "image/png" });
  files.set(SVG_URL, { bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), type: "application/octet-stream" });
  files.set(ZIP_URL, { bytes: await zipBytes({ "basemap.geojson": JSON.stringify(VECTOR) }), type: "application/zip" });
  files.set(OLD_JSON_URL, {
    bytes: new TextEncoder().encode(JSON.stringify({ basemap: { name: "Old Map", kind: "image" }, payload: { dataUrl: PNG_DATA_URL } })),
    type: "application/json",
  });
  files.set(SCENARIO_ZIP_URL, { bytes: await zipBytes({ "scenario.json": "{}", "basemap.png": PNG_BYTES, "preview.jpg": PNG_BYTES }), type: "application/zip" });

  basemapIssues = [
    issue(1, "[Basemap] Inline Relief", `### Image\n![relief](${INLINE_URL})\n\n### Basemap info\nBasemap-Hash: ${"a".repeat(64)}\nBasemap-Kind: image`),
    issue(2, "[Basemap] Coast Lines", `### Image\n[coast.svg](${SVG_URL})\n\nBasemap-Hash: ${"b".repeat(64)}\nBasemap-Kind: image`),
    issue(3, "[Basemap] Vector World", `### File\n[vector-world.zip](${ZIP_URL})\n\nBasemap-Hash: ${"c".repeat(64)}\nBasemap-Kind: vector`),
    issue(4, "Old Map", `Bundle file: ${OLD_JSON_URL}\nBasemap-Hash: ${"d".repeat(64)}`),
    issue(5, "[Basemap] A pull request", "", { pull_request: {} }),
  ];
  scenarioIssues = [
    issue(10, "[Scenario] Rome", `### Scenario file\n[rome-scenario.zip](${SCENARIO_ZIP_URL})\n\nBasemap-Hash: ${"e".repeat(64)}\nBasemap-Kind: image`),
    // Carries the same basemap as post 1, so it is listed once, as post 1.
    issue(11, "[Scenario] Relief Again", `[again.zip](https://github.com/user-attachments/files/104/again.zip)\nBasemap-Hash: ${"a".repeat(64)}`),
    issue(12, "[Scenario] Plain JSON", "https://github.com/user-attachments/files/105/plain.json"),
  ];
  return fetchCommunityBasemaps({ force: true });
};

const byId = (posts, id) => posts.find((post) => post.id === id);

test("every body shape is read as the right kind of post, with the right file", async () => {
  const posts = await setUpHub();
  assert.deepEqual(posts.map((post) => post.id), [1, 2, 3, 4, "scenario-10"]);

  const inline = byId(posts, 1);
  assert.equal(inline.title, "Inline Relief");
  assert.equal(inline.kind, "image");
  assert.equal(inline.coverImageUrl, INLINE_URL);
  assert.equal(inline.bundleUrl, null);
  assert.equal(inline.contentHash, "a".repeat(64));

  const svg = byId(posts, 2);
  assert.equal(svg.bundleUrl, SVG_URL);
  assert.equal(svg.kind, "image");

  const vector = byId(posts, 3);
  assert.equal(vector.kind, "vector");
  assert.equal(vector.bundleUrl, ZIP_URL);

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

test("install reads each post's payload and records the file a reference should point at", async () => {
  const posts = await setUpHub();
  saved.length = 0;
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
  assert.equal(saved[0].payload.dataUrl, PNG_DATA_URL);

  await installCommunityBasemap(byId(posts, "scenario-10"));
  assert.equal(saved.at(-1).payload.dataUrl, PNG_DATA_URL, "a scenario's basemap.png, not its preview");
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

  // Hub hit: the same reference, found through the post list.
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

test("a reference resolves back into the basemap it was made from", async () => {
  await setUpHub();
  const ref = (via, url) => ({ assets: { backgroundData: { mode: "communityRef", hash: "x", via, url, fileName: "background.json" } } });

  const zipped = await resolveScenarioBundleBackground(ref("dataFile", ZIP_URL));
  assert.equal(zipped.assets.backgroundData.mode, "embedded");
  assert.deepEqual(embeddedPayload(zipped), { geojson: VECTOR }, "a zipped vector is unzipped, not parsed as JSON");

  const image = await resolveScenarioBundleBackground(ref("image", INLINE_URL));
  assert.deepEqual(embeddedPayload(image), { dataUrl: PNG_DATA_URL });

  const old = await resolveScenarioBundleBackground(ref("dataFile", OLD_JSON_URL));
  assert.deepEqual(embeddedPayload(old), { dataUrl: PNG_DATA_URL });

  // Written before `via` existed: the kind decides.
  const legacy = await resolveScenarioBundleBackground({ assets: { backgroundData: { mode: "communityRef", kind: "image", url: INLINE_URL } } });
  assert.deepEqual(embeddedPayload(legacy), { dataUrl: PNG_DATA_URL });
});

test("a reference that cannot be fetched is kept, with the reason, instead of deleted", async () => {
  await setUpHub();
  const gone = { mode: "communityRef", hash: "x", via: "image", url: "https://github.com/user-attachments/assets/moved.png", fileName: "background.json" };
  const bundle = await resolveScenarioBundleBackground({ assets: { backgroundData: { ...gone } } });
  assert.deepEqual(bundle.assets.backgroundData, { ...gone, missingReason: "Not found on the hub." });
  assert.equal(unresolvedBundleBackground(bundle), "Not found on the hub.", "a whole sentence with its full stop, so a language pack can match it");

  // A file that downloads but carries no basemap is missing too.
  files.set("https://github.com/user-attachments/files/9/empty.json", { bytes: new TextEncoder().encode(JSON.stringify({ payload: {} })), type: "application/json" });
  const empty = await resolveScenarioBundleBackground({ assets: { backgroundData: { mode: "communityRef", via: "dataFile", url: "https://github.com/user-attachments/files/9/empty.json" } } });
  assert.equal(empty.assets.backgroundData.mode, "communityRef");
  assert.equal(unresolvedBundleBackground(empty), "The shared basemap has no image or map in it.");

  // Resolved, embedded or absent: nothing missing.
  const resolved = await resolveScenarioBundleBackground({ assets: { backgroundData: { mode: "communityRef", via: "image", url: INLINE_URL } } });
  assert.equal(unresolvedBundleBackground(resolved), null);
  assert.equal(unresolvedBundleBackground({ assets: {} }), null);
  assert.equal(unresolvedBundleBackground(null), null);
});
