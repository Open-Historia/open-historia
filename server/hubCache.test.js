/*! Open Historia — the community download cache: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/hubCache.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  clearHubCache,
  hubCacheUsage,
  pruneHubCache,
  saveCappedBody,
  sweepHubCache,
  touchEntry,
} from "./hubCache.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-hub-cache-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

// A cache entry of `size` bytes last used `ageMinutes` ago.
const entry = (name, size, ageMinutes = 0) => {
  const body = path.join(dir, `${name}.body`);
  fs.writeFileSync(body, Buffer.alloc(size));
  fs.writeFileSync(path.join(dir, `${name}.type`), "application/zip");
  const at = new Date(Date.now() - ageMinutes * 60000);
  fs.utimesSync(body, at, at);
  return body;
};
const names = () => fs.readdirSync(dir).sort();

// A download body of `chunkCount` chunks of `chunkSize` bytes, counting how many
// the reader actually pulled.
const body = (chunkSize, chunkCount = Infinity) => {
  const stats = { pulled: 0 };
  const stream = new ReadableStream({
    pull(controller) {
      if (stats.pulled >= chunkCount) return controller.close();
      stats.pulled += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(stats.pulled % 256));
    },
  });
  return { stream, stats };
};

test("a download is written to disk as it arrives, byte for byte", async () => {
  const { stream } = body(1000, 5);
  const destination = path.join(dir, "a.tmp");
  assert.equal(await saveCappedBody(stream, destination, 10_000), 5000);
  const written = fs.readFileSync(destination);
  assert.equal(written.length, 5000);
  assert.equal(written[0], 1);
  assert.equal(written[4999], 5);
});

test("an oversized download is refused as it passes the cap, not after it all arrived", async () => {
  // An endless body: reading it whole first, as the old code did, never ends.
  const { stream, stats } = body(1000);
  const destination = path.join(dir, "big.tmp");
  await assert.rejects(saveCappedBody(stream, destination, 10_000), (error) => {
    assert.equal(error.status, 413);
    assert.match(error.message, /too large/);
    return true;
  });
  assert.ok(stats.pulled < 40, `read ${stats.pulled} chunks of an endless body`);
  assert.equal(fs.existsSync(destination), false, "nothing is left behind");
});

test("an empty body is an empty file", async () => {
  const destination = path.join(dir, "empty.tmp");
  assert.equal(await saveCappedBody(null, destination, 10), 0);
  assert.equal(fs.readFileSync(destination).length, 0);
});

test("past the cap, the entries used longest ago go first, with their type files", () => {
  entry("old", 400, 30);
  entry("middle", 400, 20);
  entry("new", 400, 10);
  assert.deepEqual(hubCacheUsage(dir), { files: 3, bytes: 1200 });

  assert.deepEqual(pruneHubCache(dir, 1000), ["old.body"]);
  assert.deepEqual(names(), ["middle.body", "middle.type", "new.body", "new.type"]);
  assert.deepEqual(pruneHubCache(dir, 1000), [], "within the cap, nothing more goes");
});

test("opening an entry again moves it to the back of the queue", () => {
  const old = entry("old", 400, 30);
  entry("middle", 400, 20);
  entry("new", 400, 10);
  touchEntry(old);
  assert.deepEqual(pruneHubCache(dir, 1000), ["middle.body"]);
});

test("the entry just written is never the one removed", () => {
  entry("old", 400, 30);
  const huge = entry("huge", 900, 0);
  assert.deepEqual(pruneHubCache(dir, 1000, { keep: huge }), ["old.body"]);
  assert.deepEqual(names(), ["huge.body", "huge.type"]);
});

test("startup removes cut-short downloads and orphaned type files, then applies the cap", () => {
  entry("old", 600, 30);
  entry("new", 600, 10);
  fs.writeFileSync(path.join(dir, "new.body.123.abc.tmp"), "half");
  fs.writeFileSync(path.join(dir, "gone.type"), "application/zip");
  assert.deepEqual(sweepHubCache(dir, 1000), ["old.body"]);
  assert.deepEqual(names(), ["new.body", "new.type"]);
});

test("clearing empties the cache but leaves a download in progress", () => {
  entry("a", 300);
  entry("b", 200);
  fs.writeFileSync(path.join(dir, "c.body.1.x.tmp"), "in progress");
  assert.deepEqual(clearHubCache(dir), { files: 0, bytes: 0, freed: 500 });
  assert.deepEqual(names(), ["c.body.1.x.tmp"]);
});

test("a cache that was never created reads as empty", () => {
  const missing = path.join(dir, "never");
  assert.deepEqual(hubCacheUsage(missing), { files: 0, bytes: 0 });
  assert.deepEqual(pruneHubCache(missing, 0), []);
  assert.deepEqual(sweepHubCache(missing), []);
  assert.deepEqual(clearHubCache(missing), { files: 0, bytes: 0, freed: 0 });
});

// The routes, against the real server. A cached URL is served without touching
// the network, which is what lets this run offline.
test("the server serves a cached file, sweeps leftovers at startup, and clears on request", async () => {
  const { spawn } = await import("node:child_process");
  const crypto = await import("node:crypto");
  const net = await import("node:net");
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });

  const cacheDir = path.join(dir, "hub-cache");
  fs.mkdirSync(cacheDir);
  const fileUrl = "https://github.com/user-attachments/files/1/scenario.zip";
  const hash = crypto.createHash("sha256").update(fileUrl).digest("hex");
  fs.writeFileSync(path.join(cacheDir, `${hash}.body`), "PK-cached-bundle");
  fs.writeFileSync(path.join(cacheDir, `${hash}.type`), "application/zip");
  const longAgo = new Date(Date.now() - 86400000);
  fs.utimesSync(path.join(cacheDir, `${hash}.body`), longAgo, longAgo);
  fs.writeFileSync(path.join(cacheDir, `${hash}.body.999.x.tmp`), "cut short by a crash");

  const child = spawn(process.execPath, [path.join(import.meta.dirname, "server.js")], {
    env: { ...process.env, OH_DATA_DIR: dir, PORT: String(port) },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const local = (route, init) => fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { Origin: `http://127.0.0.1:${port}` } });
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        if ((await local("/api/hub/cache")).ok) break;
      } catch { /* not up yet */ }
      if (attempt > 100 || child.exitCode !== null) throw new Error("server did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.equal(fs.existsSync(path.join(cacheDir, `${hash}.body.999.x.tmp`)), false, "swept at startup");
    assert.deepEqual(await (await local("/api/hub/cache")).json(), { files: 1, bytes: 16 });

    const response = await local(`/api/hub/file?url=${encodeURIComponent(fileUrl)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(response.headers.get("content-length"), "16");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await response.text(), "PK-cached-bundle");
    assert.ok(fs.statSync(path.join(cacheDir, `${hash}.body`)).mtimeMs > longAgo.getTime() + 60000, "a hit counts as a use");

    const cleared = await (await local("/api/hub/cache", { method: "DELETE" })).json();
    assert.deepEqual(cleared, { files: 0, bytes: 0, freed: 16 });
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  } finally {
    child.kill();
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
  }
});
