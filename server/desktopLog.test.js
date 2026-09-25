/*! Open Historia — portions (Desktop log store and routes tests) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Desktop log store: where the desktop app's Electron process and its local
// server write their own entries, and what the Logging file reads back.
//
// Run: node --test server/desktopLog.test.js
//
// Against a throwaway data folder: OH_DATA_DIR is read once at import, so it is
// set before the store is loaded. Nothing here touches a real install.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-desktop-log-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
const { appendLog, clearLog, readLogSince } = await import("./logStore.js");

const LOG_DIR = path.join(DATA_DIR, "logs");
const LIVE = path.join(LOG_DIR, "app.log");

// Writes entries straight into a log file, the way an older build or the
// Electron process (which does not go through the store) would have.
const writeRaw = (file, entries) => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
};

const entry = (at, source, message, extra = {}) => ({ at, level: "error", source, event: `${source}.test`, message, ...extra });

beforeEach(() => {
  fs.rmSync(LOG_DIR, { recursive: true, force: true });
});

after(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("reading by span returns the desktop app's and server's entries from that time on, oldest first", () => {
  writeRaw(LIVE, [
    entry("2026-09-12T09:00:00.000Z", "server", "before the span"),
    entry("2026-09-12T10:00:02.000Z", "main", "updater failed"),
    entry("2026-09-12T10:00:01.000Z", "server", "disk full"),
    entry("2026-09-12T10:00:03.000Z", "client", "a page entry an older build copied here"),
    entry("2026-09-12T10:00:04.000Z", "ai", "a whole prompt an older build wrote here", { data: "x".repeat(1000) }),
  ]);
  const read = readLogSince("2026-09-12T10:00:00.000Z");
  assert.deepEqual(read.map((item) => item.message), ["disk full", "updater failed"]);
});

test("reading reaches into the rotated files when the span goes back that far", () => {
  writeRaw(`${LIVE}.2`, [entry("2026-09-12T08:00:00.000Z", "main", "oldest, out of the span")]);
  writeRaw(`${LIVE}.1`, [entry("2026-09-12T09:30:00.000Z", "main", "boot failed: port in use")]);
  writeRaw(LIVE, [entry("2026-09-12T10:00:00.000Z", "server", "latest")]);
  const read = readLogSince("2026-09-12T09:00:00.000Z");
  assert.deepEqual(read.map((item) => item.message), ["boot failed: port in use", "latest"]);
});

test("clearing removes the live file and every rotated file", () => {
  writeRaw(LIVE, [entry("2026-09-12T10:00:00.000Z", "server", "a")]);
  for (const index of [1, 2, 3, 4]) writeRaw(`${LIVE}.${index}`, [entry("2026-09-12T09:00:00.000Z", "server", "b")]);
  clearLog();
  const left = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).filter((name) => name.startsWith("app.log")) : [];
  assert.deepEqual(left, []);
  assert.deepEqual(readLogSince("1970-01-01T00:00:00.000Z"), []);
});

test("the home folder is replaced as entries are written", () => {
  const home = os.homedir();
  appendLog({ level: "error", source: "server", event: "http.500", message: `EPERM ${path.join(home, "AppData", "x.json")}`, data: { stack: `at ${path.join(home, "server.js")}:1` } });
  const onDisk = fs.readFileSync(LIVE, "utf8");
  assert.equal(onDisk.includes(home), false, "the literal home folder never reaches disk");
  assert.equal(onDisk.includes(JSON.stringify(home).slice(1, -1)), false, "nor its JSON spelling");
});

test("the home folder is replaced again as entries are read, covering older files", () => {
  writeRaw(LIVE, [entry("2026-09-12T10:00:00.000Z", "main", "ENOENT C:\\Users\\Jane Doe\\AppData\\Roaming\\open-historia", { data: "{\"stack\":\"at /home/jane/server.js\"}" })]);
  const [read] = readLogSince("2026-09-12T00:00:00.000Z");
  assert.equal(read.message, "ENOENT ~\\AppData\\Roaming\\open-historia");
  assert.equal(read.data.includes("/home/jane"), false);
});

// ---- The routes, on the real server --------------------------------------------
//
// Booted in a child process with its own throwaway data folder, as the LAN
// sharing tests do: which caller may clear the log is a property of the running
// server, not of a helper.

const SERVER = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "server.js");

const lanAddress = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal)?.address ?? null;

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

describe("the Desktop log routes", () => {
  let serverDataDir;
  let port;
  let child;
  const serverLog = () => path.join(serverDataDir, "logs", "app.log");
  const local = (route) => `http://127.0.0.1:${port}${route}`;
  // Same-origin, as the game's own page sends it.
  const sameOrigin = (host) => ({ Origin: `http://${host}:${port}` });

  before(async () => {
    serverDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-desktop-log-server-"));
    port = await freePort();
    child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, OH_DATA_DIR: serverDataDir, PORT: String(port), OH_HOST: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.resume();
    child.stderr.resume();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
      try {
        if ((await fetch(local("/api/server/network"), { signal: AbortSignal.timeout(500) })).ok) return;
      } catch { /* not up yet */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("server did not start in time");
  });

  after(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(serverDataDir, { recursive: true, force: true });
  });

  const seed = () => {
    fs.mkdirSync(path.dirname(serverLog()), { recursive: true });
    fs.writeFileSync(serverLog(), [
      entry("2026-09-12T09:00:00.000Z", "server", "before the span"),
      entry("2026-09-12T10:00:01.000Z", "main", "boot failed: port in use"),
      entry("2026-09-12T10:00:02.000Z", "client", "an old page copy"),
    ].map((item) => JSON.stringify(item)).join("\n") + "\n");
  };

  test("the page reads the Desktop log from the span's start", async () => {
    seed();
    const response = await fetch(local(`/api/log?since=${encodeURIComponent("2026-09-12T10:00:00.000Z")}`));
    assert.equal(response.status, 200);
    const { entries } = await response.json();
    assert.deepEqual(entries.map((item) => item.message), ["boot failed: port in use"]);
  });

  test("the page can no longer write into it", async () => {
    seed();
    await fetch(local("/api/log"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin("127.0.0.1") },
      body: JSON.stringify({ entries: [{ source: "client", level: "error", event: "window.error", message: "from the page" }] }),
    });
    assert.equal(fs.readFileSync(serverLog(), "utf8").includes("from the page"), false);
  });

  test("the host can clear it", async () => {
    seed();
    fs.writeFileSync(`${serverLog()}.1`, `${JSON.stringify(entry("2026-09-11T10:00:00.000Z", "server", "rotated"))}\n`);
    const response = await fetch(local("/api/log"), { method: "DELETE", headers: sameOrigin("127.0.0.1") });
    assert.equal(response.status, 200);
    const left = fs.readdirSync(path.dirname(serverLog())).filter((name) => name.startsWith("app.log"));
    assert.deepEqual(left, []);
  });

  // A player's diagnostics log carried "http.404: Asset not found: stats" with a
  // full stack eight times a turn: the client asks for a scenario's optional
  // stats sheet on every read and uses the default when there is none. A
  // missing optional asset is an answer; a scenario that is not there is still
  // an error, and still logged.
  test("an asset a scenario does not have is a quiet 404; a scenario that is not there is logged", async () => {
    fs.rmSync(path.dirname(serverLog()), { recursive: true, force: true });
    const missing = await fetch(local("/api/scenarios/default/assets/stats"));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, "Asset not found: stats", "the built-in scenario exists and simply has no stats sheet");
    const unknown = await fetch(local("/api/scenarios/no-such-scenario/assets/stats"));
    assert.equal(unknown.status, 404);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const logged = fs.existsSync(serverLog()) ? fs.readFileSync(serverLog(), "utf8") : "";
    assert.equal(logged.includes("Asset not found"), false, "the missing optional asset is not logged");
    assert.equal(logged.includes("Scenario not found"), true, "the missing scenario is");
  });
  test("another device cannot clear it", async (t) => {
    const lan = lanAddress();
    if (!lan) {
      t.skip("no non-loopback address on this host");
      return;
    }
    await fetch(local("/api/server/network"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sameOrigin("127.0.0.1") },
      body: JSON.stringify({ lanEnabled: true }),
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    seed();
    let response;
    try {
      // Same-origin from the LAN, as a phone playing on this desktop sends it:
      // the cross-origin guard lets it through, so the refusal must be the
      // route's own.
      response = await fetch(`http://${lan}:${port}/api/log`, {
        method: "DELETE",
        headers: sameOrigin(lan),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      t.skip("this host's LAN address does not reach the server");
      return;
    }
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /Only the machine running the server/, "refused by the route, not the cross-origin guard");
    assert.equal(fs.existsSync(serverLog()), true);
  });
});

test("keys are redacted as entries are written", () => {
  appendLog({ level: "warn", source: "server", event: "http.401", message: "Bearer abcdefghijklmnop refused", data: { key: "sk-abcdefghijklmnopqrst" } });
  const onDisk = fs.readFileSync(LIVE, "utf8");
  assert.equal(onDisk.includes("abcdefghijklmnop refused"), false);
  assert.equal(onDisk.includes("sk-abcdefghijklmnopqrst"), false);
});
