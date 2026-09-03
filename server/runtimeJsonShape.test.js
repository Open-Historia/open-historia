/*! Open Historia — runtime JSON shape-guard tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The write path refuses a body of the wrong shape, so a PUT that never parsed
// (express.json hands the route {}) cannot overwrite a game's event log with an
// empty object. The expectation used to be "storage or runtime-only means an
// array", which was accidentally true until `intercepts` — an object keyed by
// polity — joined the runtime-only set: every Spy-tab save then 400'd with
//
//   Failed to save /api/runtime/json/intercepts?v=…: HTTP 400
//
// These drive the real routes, one assertion per asset shape, so the guard and
// the declared defaults can never drift apart again without a red test.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-shape-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
process.env.PORT = "39518";

let httpServer;
let base;

const put = (key, body) =>
  fetch(`${base}/api/runtime/json/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const get = async (key) => (await fetch(`${base}/api/runtime/json/${key}`)).json();

before(async () => {
  ({ httpServer } = await import("./server.js"));
  base = `http://127.0.0.1:${process.env.PORT}`;
});

after(() => {
  httpServer?.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("intercepts is an object asset and round-trips", async () => {
  const intercepts = {
    Germany: {
      gatheredAt: "1938-03-12",
      round: 3,
      planted: false,
      exchanges: [{ id: "germany:3:0", counterpart: "Italy", date: "1938-03-04", subject: "Austria", messages: [{ speaker: "Germany", cipher: "AAAA" }] }],
    },
  };
  const res = await put("intercepts", intercepts);
  assert.equal(res.status, 200, "an object body must be accepted for intercepts");
  assert.deepEqual(await get("intercepts"), intercepts);
});

test("the array assets still reject an object", async () => {
  // The corruption this guard exists to stop: a body that never parsed arriving
  // as {} and replacing a game's whole event log.
  for (const key of ["events", "actions", "chat", "advisor", "snapshots"]) {
    const res = await put(key, {});
    assert.equal(res.status, 400, `${key} must refuse an object`);
    assert.match(await res.text(), /expected an array/, `${key} must say what it wanted`);
  }
});

test("the object assets still reject an array", async () => {
  for (const key of ["world", "game", "prompts", "colors", "intercepts"]) {
    const res = await put(key, []);
    assert.equal(res.status, 400, `${key} must refuse an array`);
    assert.match(await res.text(), /expected an object/, `${key} must say what it wanted`);
  }
});

test("the array assets still accept an array", async () => {
  for (const key of ["events", "actions", "chat", "advisor", "snapshots"]) {
    assert.equal((await put(key, [])).status, 200, `${key} must accept an array`);
  }
});
