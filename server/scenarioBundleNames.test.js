/*! Open Historia — scenario bundles under the current name: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioBundleNames.test.js
//
// What players downloaded before 2026-09-29 says the project's earlier name in
// its schema; the Hub download cache keeps it under the current one. What has to
// hold:
//   - the name changes and the format (1 or 2) does not, and no other byte of a
//     JSON bundle moves;
//   - a bundle already under the current name, another schema, or a file that is
//     not a bundle is left exactly as it was;
//   - a zipped bundle has its scenario.json renamed and keeps every other entry;
//   - the cache pass renames every cached bundle once, and says so with a marker.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

import {
  HUB_CACHE_NAMES_MARKER,
  renameHubCacheBundles,
  renameScenarioBundleBytes,
  renameScenarioBundleText,
} from "./scenarioBundleNames.js";

const EARLIER = "earlier-name";

test("the name changes, the format and every other byte stay", () => {
  const v2 = `{"schema":"${EARLIER}-scenario-bundle/2","version":2,"scenario":{"name":"Rome"}}`;
  assert.deepEqual(renameScenarioBundleText(v2), {
    text: `{"schema":"open-historia-scenario-bundle/2","version":2,"scenario":{"name":"Rome"}}`,
    changed: true,
  });
  const v1 = `{ "mode": "light", "schema" : "${EARLIER}-scenario-bundle", "version": 1 }`;
  assert.equal(renameScenarioBundleText(v1).text, `{ "mode": "light", "schema" : "open-historia-scenario-bundle", "version": 1 }`);
  // A game file that carries its scenario: the scenario inside is renamed too.
  const game = `{"schema":"open-historia-game-bundle/1","scenario":{"schema":"${EARLIER}-scenario-bundle/2"}}`;
  assert.equal(renameScenarioBundleText(game).text, `{"schema":"open-historia-game-bundle/1","scenario":{"schema":"open-historia-scenario-bundle/2"}}`);
});

test("what is current, another schema, or not a bundle, is left as it was", () => {
  const current = `{"schema":"open-historia-scenario-bundle/2"}`;
  assert.deepEqual(renameScenarioBundleText(current), { text: current, changed: false });
  const suggestion = `{"schema":"open-historia-scenario-suggestion/1"}`;
  assert.equal(renameScenarioBundleText(suggestion).changed, false);
  const prose = `{"description":"the ${EARLIER}-scenario-bundle format"}`;
  assert.equal(renameScenarioBundleText(prose).changed, false, "only a schema field's value");
});

test("bytes: a JSON bundle is renamed; an image or a non-bundle is untouched", async () => {
  const json = Buffer.from(`\n  {"schema":"${EARLIER}-scenario-bundle/2","data":{}}`);
  const renamed = await renameScenarioBundleBytes(json);
  assert.equal(renamed.changed, true);
  assert.equal(renamed.bytes.toString("utf8"), `\n  {"schema":"open-historia-scenario-bundle/2","data":{}}`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.equal((await renameScenarioBundleBytes(png)).bytes, png);
  const current = Buffer.from(`{"schema":"open-historia-scenario-bundle/2"}`);
  const unchanged = await renameScenarioBundleBytes(current);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.bytes, current, "the very same buffer, not a copy");
});

test("a zipped bundle has its scenario.json renamed and keeps every other entry", async () => {
  const image = Uint8Array.from({ length: 5000 }, (_, index) => (index * 37) % 256);
  const source = new JSZip();
  source.file("scenario.json", `{"schema":"${EARLIER}-scenario-bundle/2","scenario":{"name":"Map"}}`);
  source.file("basemap.png", image, { compression: "STORE" });
  source.file("preview.jpg", image.slice(0, 100), { compression: "STORE" });
  const zipped = await source.generateAsync({ type: "nodebuffer" });

  const { bytes, changed } = await renameScenarioBundleBytes(zipped);
  assert.equal(changed, true);
  const out = await JSZip.loadAsync(bytes);
  assert.equal(await out.file("scenario.json").async("string"), `{"schema":"open-historia-scenario-bundle/2","scenario":{"name":"Map"}}`);
  assert.deepEqual(await out.file("basemap.png").async("uint8array"), image);
  assert.deepEqual(await out.file("preview.jpg").async("uint8array"), image.slice(0, 100));

  const current = new JSZip();
  current.file("scenario.json", `{"schema":"open-historia-scenario-bundle/2"}`);
  const currentBytes = await current.generateAsync({ type: "nodebuffer" });
  assert.equal((await renameScenarioBundleBytes(currentBytes)).bytes, currentBytes);
});

test("the cache pass renames every cached bundle once, and leaves the rest", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-hubcache-"));
  try {
    fs.writeFileSync(path.join(dir, "a.body"), `{"schema":"${EARLIER}-scenario-bundle","data":{}}`);
    fs.writeFileSync(path.join(dir, "a.type"), "application/json");
    fs.writeFileSync(path.join(dir, "b.body"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(dir, "c.body"), `{"schema":"open-historia-scenario-bundle/2"}`);
    assert.equal(await renameHubCacheBundles(dir), 1);
    assert.equal(fs.readFileSync(path.join(dir, "a.body"), "utf8"), `{"schema":"open-historia-scenario-bundle","data":{}}`);
    assert.equal(fs.readFileSync(path.join(dir, "a.type"), "utf8"), "application/json", "the type file is not a bundle");
    assert.ok(fs.existsSync(path.join(dir, HUB_CACHE_NAMES_MARKER)));
    // Once: a later old-named file (there should be none: downloads are renamed as
    // they arrive) is not scanned for again.
    fs.writeFileSync(path.join(dir, "d.body"), `{"schema":"${EARLIER}-scenario-bundle"}`);
    assert.equal(await renameHubCacheBundles(dir), 0);
    assert.equal(await renameHubCacheBundles(path.join(dir, "missing")), 0, "no cache yet is nothing to do");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
