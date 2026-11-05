/*! Open Historia — tiled basemaps: installed from the official list, served by range © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/tiledBasemaps.test.js
//
// A Tiled Basemap is a PMTiles archive of map tiles, hundreds of megabytes, that
// a player installs once and that every Scenario naming it reuses
// (docs/adr/0005-tiled-basemaps-stream-to-disk.md). It is installed only from
// the official list, by map id and version (docs/adr/0006-official-basemap-list.md).
// These drive the real routes against a fake "official repository" on this
// machine: OH_BASEMAP_CATALOG_URL points the list at it, OH_HUB_TEST_ORIGIN
// lets the download guards accept its one origin, and the size caps are scaled
// down (OH_TILED_BASEMAP_MAX_BYTES, OH_HUB_MAX_BUNDLE_BYTES) so "too large"
// costs kilobytes, not half a gigabyte.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { buildPmtiles } from "./testPmtiles.js";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-tiled-test-"));
const BASEMAPS_DIR = path.join(DATA_DIR, "basemaps");
const CAP = 64 * 1024;

const tileBytes = (label) => Buffer.from(`RIFF-webp-stand-in-${label}`);
const archive = (label) => buildPmtiles({
  minzoom: 0,
  maxzoom: 1,
  bounds: [-10, -20, 30, 40],
  tiles: [
    { z: 0, x: 0, y: 0, bytes: tileBytes(`${label} 0/0/0`) },
    { z: 1, x: 0, y: 0, bytes: tileBytes(`${label} 1/0/0`) },
    { z: 1, x: 1, y: 0, bytes: tileBytes(`${label} 1/1/0`) },
    { z: 1, x: 0, y: 1, bytes: tileBytes(`${label} 1/0/1`) },
    { z: 1, x: 1, y: 1, bytes: tileBytes(`${label} 1/1/1`) },
  ],
});
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
// One archive per map in the list, so each test's map is its own.
const ARCHIVES = Object.fromEntries(
  ["relief", "relief-v2", "slow", "cancelled", "moved", "wrong", "authored", "fallback", "together", "older", "older-v2"].map((label) => [label, archive(label)]),
);
const VECTOR_ARCHIVE = buildPmtiles({ minzoom: 0, maxzoom: 0, tileType: 1, tiles: [{ z: 0, x: 0, y: 0, bytes: tileBytes("mvt") }] });

// ---- A fake official repository: its releases, and its basemaps.json.
let releaseBase;
let releaseServer;
const aborted = new Set();
const downloads = new Map(); // route -> times fetched
let holdStream = null;
const sendArchive = (bytes) => (req, res) => {
  res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length });
  res.end(bytes);
};
// Sends half, then waits until the test lets it finish.
const sendSlowly = (bytes) => async (req, res) => {
  res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length });
  const half = Math.floor(bytes.length / 2);
  res.write(bytes.subarray(0, half));
  await holdStream;
  res.end(bytes.subarray(half));
};
const releaseRoutes = {
  "/download/relief-v1/relief.pmtiles": sendArchive(ARCHIVES.relief),
  "/download/relief-v2/relief.pmtiles": sendArchive(ARCHIVES["relief-v2"]),
  "/download/slow-v1/slow.pmtiles": sendSlowly(ARCHIVES.slow),
  "/download/cancelled-v1/cancelled.pmtiles": sendSlowly(ARCHIVES.cancelled),
  "/download/together-v1/together.pmtiles": sendSlowly(ARCHIVES.together),
  "/download/authored-v1/authored.pmtiles": sendArchive(ARCHIVES.authored),
  "/download/fallback-v1/fallback.pmtiles": sendArchive(ARCHIVES.fallback),
  "/download/older-v1/older.pmtiles": sendArchive(ARCHIVES.older),
  "/download/older-v2/older.pmtiles": sendArchive(ARCHIVES["older-v2"]),
  // Far past the cap, and says nothing of its length up front.
  "/download/huge-v1/huge.pmtiles": async (req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    req.socket.on("close", () => aborted.add("huge"));
    const chunk = Buffer.alloc(16 * 1024, 7);
    for (let i = 0; i < 400 && !res.destroyed; i += 1) {
      if (!res.write(chunk)) await once(res, "drain").catch(() => {});
      await new Promise((resolve) => setImmediate(resolve));
    }
    res.end();
  },
  "/download/notes-v1/notes.pmtiles": (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("these are not map tiles ".repeat(40));
  },
  "/download/vector-v1/vector.pmtiles": sendArchive(VECTOR_ARCHIVE),
  "/download/moved-v1/moved.pmtiles": (req, res) => {
    res.writeHead(302, { Location: "/download/moved-v1/moved-here.pmtiles" });
    res.end();
  },
  "/download/moved-v1/moved-here.pmtiles": sendArchive(ARCHIVES.moved),
  // A release link that has been redirected off the allowed hosts.
  "/download/escapes-v1/escapes.pmtiles": (req, res) => {
    res.writeHead(302, { Location: "https://example.com/relief.pmtiles" });
    res.end();
  },
  "/download/wrong-v1/wrong.pmtiles": sendArchive(ARCHIVES.wrong),
  // The same bundle asked for twice at once is cached once, whole.
  "/download/slow-bundle.json": async (req, res) => {
    const body = JSON.stringify({ ok: true, pad: "y".repeat(CAP / 2) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write(body.slice(0, 1000));
    await new Promise((resolve) => setTimeout(resolve, 60));
    res.end(body.slice(1000));
  },
  "/download/bundle.json": (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, pad: "x".repeat(CAP / 2) }));
  },
  "/download/huge-bundle.json": (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(`"${"x".repeat(CAP * 3)}"`);
  },
  "/basemaps.json": (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(officialList));
  },
};

const version = (id, number, bytes, extra = {}) => ({
  version: number,
  url: `${releaseBase}/download/${id}-v${number}/${id}.pmtiles`,
  bytes: bytes.length,
  sha256: sha256(bytes),
  ...extra,
});
const map = (id, versions, extra = {}) => ({ id, name: `${id} map`, author: "Tester", license: "CC BY-SA 4.0", versions, ...extra });
let officialList = { format: 1, basemaps: [] };
const baseList = () => [
  map("relief", [version("relief", 1, ARCHIVES.relief)]),
  map("slow", [version("slow", 1, ARCHIVES.slow)]),
  map("cancelled", [version("cancelled", 1, ARCHIVES.cancelled)]),
  map("together", [version("together", 1, ARCHIVES.together)]),
  map("authored", [version("authored", 1, ARCHIVES.authored)]),
  map("fallback", [version("fallback", 1, ARCHIVES.fallback)]),
  map("older", [version("older", 1, ARCHIVES.older)]),
  map("moved", [version("moved", 1, ARCHIVES.moved)]),
  // Lies about its size: the download itself must stop at the cap.
  map("huge", [{ ...version("huge", 1, ARCHIVES.relief), sha256: "d".repeat(64) }]),
  map("notes", [{ ...version("notes", 1, ARCHIVES.relief), sha256: "e".repeat(64) }]),
  map("vector", [version("vector", 1, VECTOR_ARCHIVE)]),
  map("escapes", [{ ...version("escapes", 1, ARCHIVES.relief), sha256: "f".repeat(64) }]),
  // The list's checksum is not the file's: the release was replaced.
  map("wrong", [{ ...version("wrong", 1, ARCHIVES.wrong), sha256: "c".repeat(64) }]),
];

let httpServer;
let base;

before(async () => {
  releaseServer = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    downloads.set(pathname, (downloads.get(pathname) || 0) + 1);
    const route = releaseRoutes[pathname];
    if (!route) { res.writeHead(404); res.end(); return; }
    route(req, res);
  });
  releaseServer.listen(0, "127.0.0.1");
  await once(releaseServer, "listening");
  releaseBase = `http://127.0.0.1:${releaseServer.address().port}`;
  officialList = { format: 1, basemaps: baseList() };

  // A download a crash or restart cut short, left from a previous run, and an
  // archive whose entry is gone (a replaced version the map still had open).
  fs.mkdirSync(BASEMAPS_DIR, { recursive: true });
  fs.writeFileSync(path.join(BASEMAPS_DIR, ".incoming-stale.pmtiles.tmp"), "half a download");
  fs.writeFileSync(path.join(BASEMAPS_DIR, ".incoming-stale2.pmtiles"), "a download never registered");
  fs.writeFileSync(path.join(BASEMAPS_DIR, "replaced-v1.pmtiles"), "an archive with no entry");
  process.env.OH_DATA_DIR = DATA_DIR;
  process.env.PORT = "0";
  process.env.OH_HUB_TEST_ORIGIN = releaseBase;
  process.env.OH_BASEMAP_CATALOG_URL = `${releaseBase}/basemaps.json`;
  process.env.OH_TILED_BASEMAP_MAX_BYTES = String(CAP);
  process.env.OH_HUB_MAX_BUNDLE_BYTES = String(CAP);
  ({ httpServer } = await import("./server.js"));
  if (!httpServer.listening) await once(httpServer, "listening");
  base = `http://127.0.0.1:${httpServer.address().port}`;
});

after(() => {
  httpServer?.close();
  releaseServer?.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const api = async (method, route, body) => {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
};

const setOfficialList = async (basemaps) => {
  officialList = { format: 1, basemaps };
  return (await api("GET", "/api/basemaps/official?refresh=1")).json;
};

const install = (id, extra = {}) => api("POST", "/api/basemaps/official/install", { id, ...extra });

const waitForJob = async (jobId, until = (job) => job.status !== "running") => {
  for (let i = 0; i < 400; i += 1) {
    const { json } = await api("GET", `/api/basemaps/tiled/install/${jobId}`);
    if (until(json)) return json;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${jobId} never settled`);
};
const installed = async (id, extra) => {
  const started = await install(id, extra);
  assert.equal(started.status, 202, started.text);
  return waitForJob(started.json.jobId);
};

const library = async () => (await api("GET", "/api/basemaps")).json;
// Everything in the basemap folder except the metadata files: archives and
// anything half-written.
const archiveFiles = () => (fs.existsSync(BASEMAPS_DIR) ? fs.readdirSync(BASEMAPS_DIR) : []).filter((f) => !/\.json$/.test(f));
const fetched = (route) => downloads.get(route) || 0;

test("the official list is read, with what the player has of each map", async () => {
  const list = await api("GET", "/api/basemaps/official");
  assert.equal(list.status, 200, list.text);
  const relief = list.json.basemaps.find((entry) => entry.id === "relief");
  assert.equal(relief.name, "relief map");
  assert.equal(relief.license, "CC BY-SA 4.0");
  assert.equal(relief.versions.length, 1);
  assert.equal(relief.versions[0].sha256, sha256(ARCHIVES.relief));
  assert.equal(relief.installed, null);
  assert.equal(list.json.stale, false);
});

test("installing a map streams its newest version to disk, checked against the list, with zooms and bounds from its header", async () => {
  const job = await installed("relief");
  assert.equal(job.status, "done", job.error);
  assert.equal(job.received, ARCHIVES.relief.length);
  const meta = job.basemap;
  assert.equal(meta.kind, "tiled");
  assert.equal(meta.name, "relief map");
  assert.deepEqual(meta.official, { id: "relief", version: 1 });
  assert.equal(meta.bytes, ARCHIVES.relief.length);
  assert.equal(meta.minzoom, 0);
  assert.equal(meta.maxzoom, 1);
  assert.deepEqual(meta.bounds, [-10, -20, 30, 40]);
  assert.equal(meta.contentHash, sha256(ARCHIVES.relief));
  assert.ok((await library()).some((b) => b.id === meta.id), "the Basemap is in the library");

  const byId = await api("GET", "/api/basemaps/official/relief");
  assert.equal(byId.status, 200);
  assert.equal(byId.json.id, meta.id);
  const byHash = await api("GET", `/api/basemaps/by-hash/${meta.contentHash}`);
  assert.equal(byHash.json.id, meta.id);
  const relief = (await api("GET", "/api/basemaps/official")).json.basemaps.find((entry) => entry.id === "relief");
  assert.deepEqual(relief.installed, { libraryId: meta.id, version: 1 });
});

test("an installed archive is served by byte range", async () => {
  const id = (await api("GET", "/api/basemaps/official/relief")).json.id;
  const whole = await fetch(`${base}/api/basemaps/${id}/archive`);
  assert.equal(whole.status, 200);
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), ARCHIVES.relief);
  const part = await fetch(`${base}/api/basemaps/${id}/archive`, { headers: { Range: "bytes=0-126" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 0-126/${ARCHIVES.relief.length}`);
  const head = await fetch(`${base}/api/basemaps/${id}/archive`, { method: "HEAD" });
  assert.equal(Number(head.headers.get("content-length")), ARCHIVES.relief.length);
});

test("a map the player already has is never downloaded again", async () => {
  const before = fetched("/download/relief-v1/relief.pmtiles");
  const again = await installed("relief");
  assert.equal(again.status, "done", again.error);
  assert.deepEqual(again.basemap.official, { id: "relief", version: 1 });
  assert.equal(fetched("/download/relief-v1/relief.pmtiles"), before, "no second download");
  assert.equal((await library()).filter((m) => m.official?.id === "relief").length, 1);
});

test("the same map asked for twice at once is one download", async () => {
  let release;
  holdStream = new Promise((resolve) => { release = resolve; });
  const [a, b] = await Promise.all([install("together"), install("together")]);
  assert.equal(a.json.jobId, b.json.jobId, "the second request joins the first");
  await waitForJob(a.json.jobId, (job) => job.received > 0);
  release();
  const done = await waitForJob(a.json.jobId);
  holdStream = null;
  assert.equal(done.status, "done", done.error);
  assert.equal(fetched("/download/together-v1/together.pmtiles"), 1);
});

test("a newer version replaces the old one: one copy, and the old checksum finds it", async () => {
  const v1 = (await api("GET", "/api/basemaps/official/relief")).json;
  const list = await setOfficialList([
    ...baseList().filter((entry) => entry.id !== "relief"),
    map("relief", [version("relief", 1, ARCHIVES.relief), version("relief", 2, ARCHIVES["relief-v2"], { notes: "Sharper coasts" })]),
  ]);
  const relief = list.basemaps.find((entry) => entry.id === "relief");
  assert.deepEqual(relief.versions.map((v) => v.version), [1, 2]);
  assert.deepEqual(relief.installed, { libraryId: v1.id, version: 1 }, "the list says the player has the older one");

  const job = await installed("relief");
  assert.equal(job.status, "done", job.error);
  assert.deepEqual(job.basemap.official, { id: "relief", version: 2 }, "the newest version, unless asked for another");
  const copies = (await library()).filter((m) => m.official?.id === "relief");
  assert.equal(copies.length, 1, "never two versions kept");
  assert.equal(copies[0].id, job.basemap.id);
  assert.ok(!archiveFiles().includes(`${v1.id}.pmtiles`), "the old archive is gone");
  const byOldHash = await api("GET", `/api/basemaps/by-hash/${v1.contentHash}`);
  assert.equal(byOldHash.json.id, job.basemap.id, "a scenario naming the old file is drawn on the new one");
  assert.deepEqual(byOldHash.json.supersedes, [v1.contentHash]);
});

test("asking for an older version than the player has downloads nothing", async () => {
  await setOfficialList([
    ...baseList().filter((entry) => entry.id !== "older" && entry.id !== "relief"),
    map("older", [version("older", 1, ARCHIVES.older), version("older", 2, ARCHIVES["older-v2"])]),
  ]);
  const v2 = await installed("older", { version: 2 });
  assert.equal(v2.status, "done", v2.error);
  const before = fetched("/download/older-v1/older.pmtiles");
  const v1 = await installed("older", { version: 1 });
  assert.equal(v1.status, "done", v1.error);
  assert.deepEqual(v1.basemap.official, { id: "older", version: 2 }, "the newer copy serves");
  assert.equal(fetched("/download/older-v1/older.pmtiles"), before);
});

test("a map or version not on the official list cannot be installed", async () => {
  await setOfficialList(baseList());
  const notListed = await install("nowhere");
  assert.equal(notListed.status, 404);
  assert.match(notListed.json.error, /not on the official list/);
  const noVersion = await install("relief", { version: 99 });
  assert.equal(noVersion.status, 404);
  assert.match(noVersion.json.error, /Version 99/);
  // The old route that took any link is gone.
  const byLink = await api("POST", "/api/basemaps/tiled/install", { url: `${releaseBase}/download/relief-v1/relief.pmtiles` });
  assert.notEqual(byLink.status, 202);
});

test("a map the maintainers archived or deleted is listed as withdrawn and can't be installed", async () => {
  const list = await setOfficialList([
    ...baseList(),
    map("gone", [{ ...version("relief", 1, ARCHIVES.relief), archived: { date: "2026-10-03", reason: "licence" } }]),
  ]);
  const gone = list.basemaps.find((entry) => entry.id === "gone");
  assert.equal(gone.withdrawn, true);
  assert.deepEqual(gone.versions, []);
  const refused = await install("gone");
  assert.equal(refused.status, 404);
  assert.match(refused.json.error, /no longer available/);
  await setOfficialList(baseList());
});

test("a download in progress reports progress, and nothing is installed until it completes", async () => {
  let release;
  holdStream = new Promise((resolve) => { release = resolve; });
  const before = (await library()).length;
  const started = await install("slow");
  const midway = await waitForJob(started.json.jobId, (job) => job.received > 0);
  assert.equal(midway.status, "running");
  assert.equal(midway.total, ARCHIVES.slow.length);
  assert.ok(midway.received < ARCHIVES.slow.length);
  assert.equal((await library()).length, before, "no Basemap while the download runs");
  release();
  const done = await waitForJob(started.json.jobId);
  assert.equal(done.status, "done", done.error);
  holdStream = null;
});

test("a download is cancellable, and a cancelled one leaves nothing behind", async () => {
  let release;
  holdStream = new Promise((resolve) => { release = resolve; });
  const leftoversBefore = archiveFiles().length;
  const before = (await library()).length;
  const started = await install("cancelled");
  await waitForJob(started.json.jobId, (job) => job.received > 0);
  const cancelled = await api("DELETE", `/api/basemaps/tiled/install/${started.json.jobId}`);
  assert.equal(cancelled.status, 200);
  const job = await waitForJob(started.json.jobId);
  assert.equal(job.status, "cancelled");
  release();
  holdStream = null;
  assert.equal((await library()).length, before);
  assert.equal(archiveFiles().length, leftoversBefore, "no partial file left");
});

test("a download past the cap stops at once and leaves nothing behind", async () => {
  const leftoversBefore = archiveFiles().length;
  const before = (await library()).length;
  const job = await installed("huge");
  assert.equal(job.status, "failed");
  assert.match(job.error, /too large/i);
  assert.ok(job.received <= CAP + 64 * 1024, `stopped near the cap, not after ${job.received} bytes`);
  assert.equal((await library()).length, before);
  assert.equal(archiveFiles().length, leftoversBefore, "no partial file left");
  for (let i = 0; i < 100 && !aborted.has("huge"); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(aborted.has("huge"), "the connection to the release was closed");
});

test("a file that is not a raster tile archive is refused and nothing is installed", async () => {
  const before = (await library()).length;
  const leftoversBefore = archiveFiles().length;
  const text = await installed("notes");
  assert.equal(text.status, "failed");
  assert.match(text.error, /not a PMTiles archive/i);
  const vector = await installed("vector");
  assert.equal(vector.status, "failed");
  assert.match(vector.error, /raster/i);
  assert.equal((await library()).length, before);
  assert.equal(archiveFiles().length, leftoversBefore);
});

test("a download whose bytes are not the ones the list names is refused", async () => {
  const before = (await library()).length;
  const leftoversBefore = archiveFiles().length;
  const job = await installed("wrong");
  assert.equal(job.status, "failed");
  assert.match(job.error, /not the map it should be/i);
  assert.equal((await library()).length, before);
  assert.equal(archiveFiles().length, leftoversBefore);
});

test("a redirect inside the allowed origin is followed; one off GitHub fails and leaves nothing behind", async () => {
  const moved = await installed("moved");
  assert.equal(moved.status, "done", moved.error);
  const leftoversBefore = archiveFiles().length;
  const escapes = await installed("escapes");
  assert.equal(escapes.status, "failed");
  assert.match(escapes.error, /off GitHub/);
  assert.equal(archiveFiles().length, leftoversBefore);
});

test("leftovers of an interrupted download, and archives with no entry, are cleared when the server starts", () => {
  assert.deepEqual(archiveFiles().filter((f) => f.startsWith(".incoming-stale") || f === "replaced-v1.pmtiles"), []);
});

test("an author's own map is added from a file, streamed, within the cap; one that is an official version becomes it", async () => {
  const res = await fetch(`${base}/api/basemaps/tiled?name=${encodeURIComponent("Authored")}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: ARCHIVES.authored,
  });
  assert.equal(res.status, 201);
  const meta = await res.json();
  assert.equal(meta.kind, "tiled");
  assert.equal(meta.official, undefined, "an added file is the author's own until the list says otherwise");

  // The list has it, byte for byte: it is that official version, never downloaded.
  const before = fetched("/download/authored-v1/authored.pmtiles");
  const listed = (await api("GET", "/api/basemaps/official")).json.basemaps.find((entry) => entry.id === "authored");
  assert.deepEqual(listed.installed, { libraryId: meta.id, version: 1 });
  const job = await installed("authored");
  assert.equal(job.basemap.id, meta.id);
  assert.equal(fetched("/download/authored-v1/authored.pmtiles"), before);

  const tooBig = await fetch(`${base}/api/basemaps/tiled?name=big`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.alloc(CAP * 2, 1),
  });
  assert.equal(tooBig.status, 413);
});

test("a Tiled Basemap carries its vector fallback, and deleting it removes its files", async () => {
  const job = await installed("fallback");
  const id = job.basemap.id;
  const fallback = { type: "FeatureCollection", features: [{ type: "Feature", properties: { fill: "#446" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] };
  const put = await api("PUT", `/api/basemaps/${id}/payload`, { geojson: fallback });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual((await api("GET", `/api/basemaps/${id}/payload`)).json, { geojson: fallback });
  assert.ok(archiveFiles().some((f) => f.startsWith(id)), "its archive is on disk");
  const removed = await api("DELETE", `/api/basemaps/${id}`);
  assert.equal(removed.status, 200);
  assert.ok(!archiveFiles().some((f) => f.startsWith(`${id}.`)), "its archive is gone");
  assert.equal((await api("GET", `/api/basemaps/by-hash/${job.basemap.contentHash}`)).status, 404);
  assert.equal((await api("GET", "/api/basemaps/official/fallback")).status, 404);
});

test("the same hub file asked for twice at once is cached once, whole", async () => {
  const link = `${base}/api/hub/file?url=${encodeURIComponent(`${releaseBase}/download/slow-bundle.json`)}`;
  const [a, b] = await Promise.all([fetch(link), fetch(link)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal((await a.json()).ok, true);
  assert.equal((await b.json()).ok, true);
  const again = await fetch(link);
  assert.equal((await again.json()).ok, true, "the cached copy is whole");
});

test("hub scenario downloads keep their own cap and are streamed to the cache", async () => {
  const ok = await fetch(`${base}/api/hub/file?url=${encodeURIComponent(`${releaseBase}/download/bundle.json`)}`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  const tooBig = await fetch(`${base}/api/hub/file?url=${encodeURIComponent(`${releaseBase}/download/huge-bundle.json`)}`);
  assert.equal(tooBig.status, 413);
  const cacheDir = path.join(DATA_DIR, "hub-cache");
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];
  assert.ok(!cached.some((f) => f.endsWith(".tmp")), "no half-written cache file");
  const hugeKey = crypto.createHash("sha256").update(`${releaseBase}/download/huge-bundle.json`).digest("hex");
  assert.ok(!cached.includes(`${hugeKey}.body`), "the bundle past the cap is not cached");
});

test("the library can say which scenarios name a Tiled Basemap", async () => {
  const id = (await api("GET", "/api/basemaps/official/relief")).json.id;
  const users = await api("GET", `/api/basemaps/${id}/users`);
  assert.equal(users.status, 200);
  assert.deepEqual(users.json, []);
});

test("with the list unreachable, the last one read is kept, marked stale", async () => {
  const saved = releaseRoutes["/basemaps.json"];
  releaseRoutes["/basemaps.json"] = (req, res) => { res.writeHead(503); res.end(); };
  try {
    const list = await api("GET", "/api/basemaps/official?refresh=1");
    assert.equal(list.status, 200);
    assert.equal(list.json.stale, true);
    assert.match(list.json.error, /HTTP 503/);
    assert.ok(list.json.basemaps.some((entry) => entry.id === "relief"), "the maps it knew are still offered");
  } finally {
    releaseRoutes["/basemaps.json"] = saved;
  }
});
