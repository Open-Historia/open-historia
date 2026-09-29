/*! Open Historia — tiled basemaps: installed to disk, served by range © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/tiledBasemaps.test.js
//
// A Tiled Basemap is a PMTiles archive of map tiles, hundreds of megabytes, that
// a player installs once from a GitHub release and that every Scenario naming it
// reuses (docs/adr/0005-tiled-basemaps-stream-to-disk.md). These drive the real
// routes against a fake "GitHub release" on this machine: OH_HUB_TEST_ORIGIN lets
// the hub download guard accept that one origin, and the size caps are scaled
// down (OH_TILED_BASEMAP_MAX_BYTES, OH_HUB_MAX_BUNDLE_BYTES) so "too large" costs
// kilobytes, not half a gigabyte.

import assert from "node:assert/strict";
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
const ARCHIVE = buildPmtiles({
  minzoom: 0,
  maxzoom: 1,
  bounds: [-10, -20, 30, 40],
  tiles: [
    { z: 0, x: 0, y: 0, bytes: tileBytes("0/0/0") },
    { z: 1, x: 0, y: 0, bytes: tileBytes("1/0/0") },
    { z: 1, x: 1, y: 0, bytes: tileBytes("1/1/0") },
    { z: 1, x: 0, y: 1, bytes: tileBytes("1/0/1") },
    { z: 1, x: 1, y: 1, bytes: tileBytes("1/1/1") },
  ],
});
const VECTOR_ARCHIVE = buildPmtiles({ minzoom: 0, maxzoom: 0, tileType: 1, tiles: [{ z: 0, x: 0, y: 0, bytes: tileBytes("mvt") }] });

// ---- A fake GitHub release.
let releaseBase;
let releaseServer;
const aborted = new Set();
let holdStream = null;
const releaseRoutes = {
  "/download/relief.pmtiles": (req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": ARCHIVE.length });
    res.end(ARCHIVE);
  },
  // Sends half, then waits until the test lets it finish.
  "/download/slow.pmtiles": async (req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": ARCHIVE.length });
    const half = Math.floor(ARCHIVE.length / 2);
    res.write(ARCHIVE.subarray(0, half));
    await holdStream;
    res.end(ARCHIVE.subarray(half));
  },
  // Far past the cap, and says nothing of its length up front.
  "/download/huge.pmtiles": async (req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    req.socket.on("close", () => aborted.add("huge"));
    const chunk = Buffer.alloc(16 * 1024, 7);
    for (let i = 0; i < 400 && !res.destroyed; i += 1) {
      if (!res.write(chunk)) await once(res, "drain").catch(() => {});
      await new Promise((resolve) => setImmediate(resolve));
    }
    res.end();
  },
  "/download/notes.txt": (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("these are not map tiles ".repeat(40));
  },
  "/download/vector.pmtiles": (req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(VECTOR_ARCHIVE);
  },
  "/download/moved.pmtiles": (req, res) => {
    res.writeHead(302, { Location: "/download/relief.pmtiles" });
    res.end();
  },
  // A release link that has been redirected off the allowed hosts.
  "/download/escapes.pmtiles": (req, res) => {
    res.writeHead(302, { Location: "https://example.com/relief.pmtiles" });
    res.end();
  },
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
};

let httpServer;
let base;

before(async () => {
  releaseServer = http.createServer((req, res) => {
    const route = releaseRoutes[new URL(req.url, "http://x").pathname];
    if (!route) { res.writeHead(404); res.end(); return; }
    route(req, res);
  });
  releaseServer.listen(0, "127.0.0.1");
  await once(releaseServer, "listening");
  releaseBase = `http://127.0.0.1:${releaseServer.address().port}`;

  // A download a crash or restart cut short, left from a previous run.
  fs.mkdirSync(BASEMAPS_DIR, { recursive: true });
  fs.writeFileSync(path.join(BASEMAPS_DIR, ".incoming-stale.pmtiles.tmp"), "half a download");
  fs.writeFileSync(path.join(BASEMAPS_DIR, ".incoming-stale2.pmtiles"), "a download never registered");
  process.env.OH_DATA_DIR = DATA_DIR;
  process.env.PORT = "0";
  process.env.OH_HUB_TEST_ORIGIN = releaseBase;
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

const install = (name, file, extra = {}) =>
  api("POST", "/api/basemaps/tiled/install", { url: `${releaseBase}/download/${file}`, name, ...extra });

const waitForJob = async (jobId, until = (job) => job.status !== "running") => {
  for (let i = 0; i < 400; i += 1) {
    const { json } = await api("GET", `/api/basemaps/tiled/install/${jobId}`);
    if (until(json)) return json;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${jobId} never settled`);
};

const catalog = async () => (await api("GET", "/api/basemaps")).json;
// Everything in the basemap folder except the metadata files: archives and
// anything half-written.
const archiveFiles = () => (fs.existsSync(BASEMAPS_DIR) ? fs.readdirSync(BASEMAPS_DIR) : []).filter((f) => !/\.json$/.test(f));

test("installing streams the archive to disk and records the zoom range and bounds from its header", async () => {
  const started = await install("Relief World", "relief.pmtiles");
  assert.equal(started.status, 202, started.text);
  const job = await waitForJob(started.json.jobId);
  assert.equal(job.status, "done", job.error);
  assert.equal(job.received, ARCHIVE.length);
  const meta = job.basemap;
  assert.equal(meta.kind, "tiled");
  assert.equal(meta.name, "Relief World");
  assert.equal(meta.bytes, ARCHIVE.length);
  assert.equal(meta.minzoom, 0);
  assert.equal(meta.maxzoom, 1);
  assert.deepEqual(meta.bounds, [-10, -20, 30, 40]);
  assert.match(meta.contentHash, /^[a-f0-9]{64}$/);
  assert.ok((await catalog()).some((b) => b.id === meta.id), "the Basemap is in the library");

  const byHash = await api("GET", `/api/basemaps/by-hash/${meta.contentHash}`);
  assert.equal(byHash.status, 200);
  assert.equal(byHash.json.id, meta.id);
});

test("an installed archive is served by byte range", async () => {
  const job = await waitForJob((await install("Relief again", "relief.pmtiles")).json.jobId);
  const id = job.basemap.id;
  const whole = await fetch(`${base}/api/basemaps/${id}/archive`);
  assert.equal(whole.status, 200);
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), ARCHIVE);
  const part = await fetch(`${base}/api/basemaps/${id}/archive`, { headers: { Range: "bytes=0-126" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 0-126/${ARCHIVE.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), ARCHIVE.subarray(0, 127));
  const head = await fetch(`${base}/api/basemaps/${id}/archive`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), ARCHIVE.length);
});

test("the same archive installed twice is one Basemap", async () => {
  const a = await waitForJob((await install("Relief one", "relief.pmtiles")).json.jobId);
  const b = await waitForJob((await install("Relief two", "relief.pmtiles")).json.jobId);
  assert.equal(a.basemap.id, b.basemap.id);
  assert.equal((await catalog()).filter((m) => m.contentHash === a.basemap.contentHash).length, 1);
});

test("a redirect inside the allowed origin is followed", async () => {
  const job = await waitForJob((await install("Moved", "moved.pmtiles")).json.jobId);
  assert.equal(job.status, "done", job.error);
});

test("a download in progress reports progress, and nothing is installed until it completes", async () => {
  let release;
  holdStream = new Promise((resolve) => { release = resolve; });
  const before = (await catalog()).length;
  const started = await install("Slow", "slow.pmtiles");
  const midway = await waitForJob(started.json.jobId, (job) => job.received > 0);
  assert.equal(midway.status, "running");
  assert.equal(midway.total, ARCHIVE.length);
  assert.ok(midway.received < ARCHIVE.length);
  assert.equal((await catalog()).length, before, "no Basemap while the download runs");
  release();
  const done = await waitForJob(started.json.jobId);
  assert.equal(done.status, "done", done.error);
  holdStream = null;
});

test("a download is cancellable, and a cancelled one leaves nothing behind", async () => {
  let release;
  holdStream = new Promise((resolve) => { release = resolve; });
  const leftoversBefore = archiveFiles().length;
  const before = (await catalog()).length;
  const started = await install("Cancelled", "slow.pmtiles");
  await waitForJob(started.json.jobId, (job) => job.received > 0);
  const cancelled = await api("DELETE", `/api/basemaps/tiled/install/${started.json.jobId}`);
  assert.equal(cancelled.status, 200);
  const job = await waitForJob(started.json.jobId);
  assert.equal(job.status, "cancelled");
  release();
  holdStream = null;
  assert.equal((await catalog()).length, before);
  assert.equal(archiveFiles().length, leftoversBefore, "no partial file left");
});

test("a download past the cap stops at once and leaves nothing behind", async () => {
  const leftoversBefore = archiveFiles().length;
  const before = (await catalog()).length;
  const job = await waitForJob((await install("Huge", "huge.pmtiles")).json.jobId);
  assert.equal(job.status, "failed");
  assert.match(job.error, /too large/i);
  assert.ok(job.received <= CAP + 64 * 1024, `stopped near the cap, not after ${job.received} bytes`);
  assert.equal((await catalog()).length, before);
  assert.equal(archiveFiles().length, leftoversBefore, "no partial file left");
  for (let i = 0; i < 100 && !aborted.has("huge"); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(aborted.has("huge"), "the connection to the release was closed");
});

test("a file that is not a raster tile archive is refused and nothing is installed", async () => {
  const before = (await catalog()).length;
  const leftoversBefore = archiveFiles().length;
  const text = await waitForJob((await install("Notes", "notes.txt")).json.jobId);
  assert.equal(text.status, "failed");
  assert.match(text.error, /not a PMTiles archive/i);
  const vector = await waitForJob((await install("Vector tiles", "vector.pmtiles")).json.jobId);
  assert.equal(vector.status, "failed");
  assert.match(vector.error, /raster/i);
  assert.equal((await catalog()).length, before);
  assert.equal(archiveFiles().length, leftoversBefore);
});

test("leftovers of an interrupted download are cleared when the server starts", () => {
  assert.deepEqual(archiveFiles().filter((f) => f.startsWith(".incoming-stale")), []);
});

test("a release link that redirects off GitHub fails, and leaves nothing behind", async () => {
  const leftoversBefore = archiveFiles().length;
  const job = await waitForJob((await install("Escapes", "escapes.pmtiles")).json.jobId);
  assert.equal(job.status, "failed");
  assert.match(job.error, /off GitHub/);
  assert.equal(archiveFiles().length, leftoversBefore);
});

test("a download that is not the Basemap the scenario names is refused", async () => {
  const before = (await catalog()).length;
  const leftoversBefore = archiveFiles().length;
  const job = await waitForJob((await install("Wrong map", "relief.pmtiles", { expectedHash: "c".repeat(64) })).json.jobId);
  assert.equal(job.status, "failed");
  assert.match(job.error, /not the map/i);
  assert.equal((await catalog()).length, before);
  assert.equal(archiveFiles().length, leftoversBefore);
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

test("an install from outside GitHub is refused", async () => {
  const refused = await api("POST", "/api/basemaps/tiled/install", { url: "https://example.com/relief.pmtiles", name: "Elsewhere" });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /GitHub/);
});

test("an author can add a Tiled Basemap from a local file, streamed, within the cap", async () => {
  const res = await fetch(`${base}/api/basemaps/tiled?name=${encodeURIComponent("Authored")}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: ARCHIVE,
  });
  assert.equal(res.status, 201);
  const meta = await res.json();
  assert.equal(meta.kind, "tiled");
  assert.equal(meta.maxzoom, 1);
  const tooBig = await fetch(`${base}/api/basemaps/tiled?name=big`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.alloc(CAP * 2, 1),
  });
  assert.equal(tooBig.status, 413);
});

test("a Tiled Basemap carries its vector fallback, and deleting it removes its files", async () => {
  const job = await waitForJob((await install("With fallback", "relief.pmtiles")).json.jobId);
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
  const hugeKey = (await import("node:crypto")).createHash("sha256").update(`${releaseBase}/download/huge-bundle.json`).digest("hex");
  assert.ok(!cached.includes(`${hugeKey}.body`), "the bundle past the cap is not cached");
});

test("an author records where a Tiled Basemap is published, and only a GitHub release link to a .pmtiles file is accepted", async () => {
  const job = await waitForJob((await install("Linked", "relief.pmtiles")).json.jobId);
  const id = job.basemap.id;
  const link = "https://github.com/someone/maps/releases/download/v1/westeros.pmtiles";
  const ok = await api("PUT", `/api/basemaps/${id}/source`, { payloadUrl: link });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.source.payloadUrl, link);
  for (const bad of ["https://example.com/westeros.pmtiles", "https://github.com/someone/maps/blob/main/westeros.pmtiles", "javascript:alert(1)"]) {
    assert.equal((await api("PUT", `/api/basemaps/${id}/source`, { payloadUrl: bad })).status, 400, bad);
  }
});

test("the library can say which scenarios name a Tiled Basemap", async () => {
  const job = await waitForJob((await install("Named", "relief.pmtiles")).json.jobId);
  const users = await api("GET", `/api/basemaps/${job.basemap.id}/users`);
  assert.equal(users.status, 200);
  assert.deepEqual(users.json, []);
});
