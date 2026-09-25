/*! Open Historia — Prefer: return=minimal on runtime JSON writes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The rollback archive (snapshots.json) is written whole every turn and runs to
// 8-21 MB on a long game. The write used to read the file back and send all of
// it to the page, which parsed it again: a copy in this process and one on the
// page, per turn, for a reply nobody used. A writer that says
// `Prefer: return=minimal` gets 204 instead; everyone else still gets the echo.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-minimal-return-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
process.env.PORT = "39519";

let httpServer;
let base;

const put = (key, body, headers = {}) =>
  fetch(`${base}/api/runtime/json/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

before(async () => {
  ({ httpServer } = await import("./server.js"));
  base = `http://127.0.0.1:${process.env.PORT}`;
});

after(() => {
  httpServer?.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const archive = [
  { id: "snap-2-1", round: 2, fromDate: "2014-02-01", toDate: "2014-03-01", state: { game: { round: 2 }, world: { note: "second" } } },
  { id: "snap-1-1", round: 1, fromDate: "2014-01-01", toDate: "2014-02-01", state: { game: { round: 1 }, world: { note: "first" } } },
];

test("a minimal write stores the archive and answers 204 with no body", async () => {
  const res = await put("snapshots", archive, { Prefer: "return=minimal" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("preference-applied"), "return=minimal");
  assert.equal(await res.text(), "");
  const stored = await (await fetch(`${base}/api/runtime/json/snapshots`)).json();
  assert.deepEqual(stored, archive);
  // The derived index is still written from the array in hand.
  const index = await (await fetch(`${base}/api/runtime/json/snapshotsIndex`)).json();
  assert.deepEqual(index.entries.map((entry) => entry.id), ["snap-2-1", "snap-1-1"]);
});

test("without the preference the write still echoes the stored record", async () => {
  const res = await put("snapshots", archive.slice(1));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), archive.slice(1));
});
