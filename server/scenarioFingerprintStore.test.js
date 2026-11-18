/*! Open Historia — a scenario's map checksum, from the library: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioFingerprintStore.test.js
//
// What a shared game's host states of its map in the lobby, and each guest's
// own copy is checked against (libraryStore.js scenarioMapFingerprint). Runs in
// a child process because OH_DATA_DIR is read once, at import time.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const square = (id) => ({ type: "Feature", id, properties: { id, owner: "Vinland" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } });

// Two libraries, as two devices hold them.
const fingerprints = (regions) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-fingerprint-store-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    store.createScenario({ id: "vinland", name: "Vinland" });
    const before = store.scenarioMapFingerprint("vinland");
    store.uploadScenarioAsset("vinland", "regionsGeojson", Buffer.from(${JSON.stringify(JSON.stringify(regions))}));
    const after = store.scenarioMapFingerprint("vinland");
    let missing = "";
    try { store.scenarioMapFingerprint("atlantis"); } catch (error) { missing = String(error.message); }
    process.stdout.write("\\n@@" + JSON.stringify({ before, after, missing }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};

test("two libraries holding one map agree on its checksum; a region more on one copy, and they do not", () => {
  const one = { type: "FeatureCollection", features: [square("r1")] };
  const two = { type: "FeatureCollection", features: [square("r1"), square("r2")] };
  const host = fingerprints(one);
  const guest = fingerprints(one);
  assert.match(host.after, /^[0-9a-f]{64}$/);
  assert.equal(guest.after, host.after, "the same map, wherever it is kept");
  assert.notEqual(host.after, host.before, "the map the scenario had before is another");
  assert.notEqual(fingerprints(two).after, host.after, "a copy with a region more");
  assert.match(host.missing, /not in this library/);
});
