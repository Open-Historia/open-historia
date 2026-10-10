/*! Open Historia — one restore point by id © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/runtimeRestorePointRoute.test.js
//
// The staged reveal needs the world one turn started from. It used to read the
// whole rollback archive (up to twelve worlds, 8-21 MB) to keep one entry;
// GET /api/runtime/snapshots/:id sends just that one, from its own file.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-restore-point-route-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
process.env.PORT = "39520";

let httpServer;
let base;

before(async () => {
  ({ httpServer } = await import("./server.js"));
  base = `http://127.0.0.1:${process.env.PORT}`;
});

after(() => {
  httpServer?.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const archive = [
  { id: "snap-2-1", round: 2, fromDate: "2014-02-01", toDate: "2014-03-01", capturedAt: "b", state: { world: { note: "second" } } },
  { id: "snap-1-1", round: 1, fromDate: "2014-01-01", toDate: "2014-02-01", capturedAt: "a", state: { world: { note: "first" } } },
];

test("one restore point is sent by its id, and an unknown id is a 404", async () => {
  const written = await fetch(`${base}/api/runtime/json/snapshots`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(archive),
  });
  assert.equal(written.status, 204);

  const one = await fetch(`${base}/api/runtime/snapshots/snap-1-1`);
  assert.equal(one.status, 200);
  assert.equal(one.headers.get("cache-control"), "no-store");
  assert.deepEqual(await one.json(), archive[1]);

  const missing = await fetch(`${base}/api/runtime/snapshots/snap-9-9`);
  assert.equal(missing.status, 404);
});
