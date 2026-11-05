/*! Open Historia — desktop self-update route tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The desktop app updates itself through these three routes. They read the updater
// off globalThis, which the Electron main process publishes and nothing else does —
// so the same server binary is inert in the zip build and live inside the app, and
// both halves of that are what this checks.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-update-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
process.env.PORT = "39517";

let httpServer;
let base;

// A stand-in for electron-updater. The real one is only reachable from a packaged
// Electron main process, so what is under test here is the wiring, not Squirrel.
const fake = () => {
  const calls = [];
  let state = { state: "idle", percent: 0, version: "", error: "" };
  return {
    calls,
    setState: (next) => { state = { ...state, ...next }; },
    handle: {
      status: () => state,
      check: () => calls.push("check"),
      download: () => calls.push("download"),
      restart: () => calls.push("restart"),
    },
  };
};

before(async () => {
  ({ httpServer } = await import("./server.js"));
  base = `http://127.0.0.1:${process.env.PORT}`;
});

after(() => {
  httpServer?.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("without an updater the routes report unsupported and refuse to act", async () => {
  delete globalThis.__ohAutoUpdate;

  const status = await fetch(`${base}/api/app-update/status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { supported: false });

  // 404 rather than 500: this build genuinely has no such capability, and the
  // banner reads the failure as "fall back to the installer download".
  for (const route of ["download", "restart"]) {
    const res = await fetch(`${base}/api/app-update/${route}`, { method: "POST" });
    assert.equal(res.status, 404, `${route} must 404 without an updater`);
  }
});

test("status passes the updater's own state through", async () => {
  const updater = fake();
  globalThis.__ohAutoUpdate = updater.handle;
  updater.setState({ state: "downloading", percent: 42, version: "0.0.7" });

  const res = await fetch(`${base}/api/app-update/status`);
  assert.deepEqual(await res.json(), {
    supported: true,
    state: "downloading",
    percent: 42,
    version: "0.0.7",
    error: "",
  });
});

test("download starts the updater and returns immediately", async () => {
  const updater = fake();
  globalThis.__ohAutoUpdate = updater.handle;

  const res = await fetch(`${base}/api/app-update/download`, { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { started: true });
  // The point of the route: it must NOT hold the request open for the length of a
  // ~100MB download — the page follows it through /status instead.
  assert.deepEqual(updater.calls, ["download"]);
});

test("restart only installs an update that finished downloading", async () => {
  const updater = fake();
  globalThis.__ohAutoUpdate = updater.handle;

  updater.setState({ state: "downloading", percent: 61 });
  const early = await fetch(`${base}/api/app-update/restart`, { method: "POST" });
  assert.equal(early.status, 409, "restarting mid-download would lose the download");
  assert.deepEqual(updater.calls, []);

  updater.setState({ state: "ready", percent: 100 });
  const ready = await fetch(`${base}/api/app-update/restart`, { method: "POST" });
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { restarting: true });
  assert.deepEqual(updater.calls, ["restart"]);
});

test("the manifest reports local updater capability even when GitHub is unreachable", async (t) => {
  // Release metadata is remote, but the desktop updater lives in this process.
  // Keep the test offline and deterministic rather than relying on GitHub timing.
  const networkFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (resource, options) => {
    if (String(resource).startsWith(base)) return networkFetch(resource, options);
    if (String(resource).startsWith("https://github.com/Open-Historia/open-historia/releases/download/")) {
      return Promise.reject(new Error("test: release host unreachable"));
    }
    return networkFetch(resource, options);
  });

  globalThis.__ohAutoUpdate = fake().handle;
  const on = await (await fetch(`${base}/api/app-update?track=desktop`)).json();
  assert.equal(on.autoUpdate, true);

  delete globalThis.__ohAutoUpdate;
  // A separate track also reports the now-absent local updater.
  const off = await (await fetch(`${base}/api/app-update?track=stable`)).json();
  assert.equal(off.autoUpdate, false);
  assert.equal(off.buildId, undefined, "offline replies must not invent a release");
});

test("cached release metadata never caches the local updater capability", async (t) => {
  const networkFetch = globalThis.fetch;
  let manifestRequests = 0;
  t.mock.method(globalThis, "fetch", (resource, options) => {
    if (String(resource).startsWith(base)) return networkFetch(resource, options);
    if (String(resource).startsWith("https://github.com/Open-Historia/open-historia/releases/download/")) {
      manifestRequests += 1;
      return Promise.resolve(new Response(JSON.stringify({
        build: "test-desktop-build", notes: "Test release",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return networkFetch(resource, options);
  });

  globalThis.__ohAutoUpdate = fake().handle;
  const first = await (await fetch(`${base}/api/app-update?track=desktop`)).json();
  assert.equal(first.buildId, "test-desktop-build");
  assert.equal(first.autoUpdate, true);

  delete globalThis.__ohAutoUpdate;
  const second = await (await fetch(`${base}/api/app-update?track=desktop`)).json();
  assert.equal(second.buildId, first.buildId, "the feed remains cached");
  assert.equal(second.autoUpdate, false, "the local updater capability is not cached");
  assert.equal(manifestRequests, 1, "cache hits must not re-fetch the feed");
});

test("failed release HTTP responses still report local desktop capability", async (t) => {
  const networkFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (resource, options) => {
    if (String(resource).startsWith(base)) return networkFetch(resource, options);
    if (String(resource).startsWith("https://github.com/Open-Historia/open-historia/releases/download/")) {
      return Promise.resolve(new Response("service unavailable", { status: 503 }));
    }
    return networkFetch(resource, options);
  });

  globalThis.__ohAutoUpdate = fake().handle;
  const unavailable = await (await fetch(`${base}/api/app-update?track=beta`)).json();
  assert.equal(unavailable.autoUpdate, true);
  assert.equal(unavailable.buildId, undefined, "a failed feed must not invent a release");

  const unknown = await (await fetch(`${base}/api/app-update?track=not-a-track`)).json();
  assert.deepEqual(unknown, {}, "unknown tracks still return no update information");
  delete globalThis.__ohAutoUpdate;
});
