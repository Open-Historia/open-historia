/*! Open Historia — a shared game's engine window routes: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The desktop host opens and closes its shared game's hidden engine window through
// these routes. They read the handle off globalThis, which only the Electron main
// process publishes (electron/main.cjs), so the same server is inert anywhere
// else, and another website can never reach them.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-engine-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
process.env.PORT = "39541";

let httpServer;
let base;

before(async () => {
  ({ httpServer } = await import("./server.js"));
  base = `http://127.0.0.1:${process.env.PORT}`;
});

after(() => {
  httpServer?.close();
  delete globalThis.__ohSharedGameEngine;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("outside the desktop app there is no engine window to open", async () => {
  delete globalThis.__ohSharedGameEngine;
  assert.deepEqual(await (await fetch(`${base}/api/multiplayer/engine`)).json(), { supported: false });
  for (const route of ["open", "close"]) {
    const res = await fetch(`${base}/api/multiplayer/engine/${route}`, { method: "POST" });
    assert.equal(res.status, 404);
  }
});

test("inside it, the routes open, report and close the window", async () => {
  let open = false;
  globalThis.__ohSharedGameEngine = {
    status: () => ({ open }),
    open: async () => { open = true; return { open }; },
    close: () => { open = false; return { open }; },
  };
  assert.deepEqual(await (await fetch(`${base}/api/multiplayer/engine/open`, { method: "POST" })).json(), { open: true });
  assert.deepEqual(await (await fetch(`${base}/api/multiplayer/engine`)).json(), { supported: true, open: true });
  assert.deepEqual(await (await fetch(`${base}/api/multiplayer/engine/close`, { method: "POST" })).json(), { open: false });
});

test("another website cannot open it", async () => {
  let opened = false;
  globalThis.__ohSharedGameEngine = { status: () => ({ open: opened }), open: async () => { opened = true; return { open: true }; }, close: () => ({ open: false }) };
  const res = await fetch(`${base}/api/multiplayer/engine/open`, { method: "POST", headers: { Origin: "https://evil.example" } });
  assert.notEqual(res.status, 200);
  assert.equal(opened, false);
});
