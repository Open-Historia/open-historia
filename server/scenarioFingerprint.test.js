/*! Open Historia — a scenario's map, by its checksum: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioFingerprint.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mapFingerprint } from "./scenarioFingerprint.js";

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "oh-fingerprint-"));
const write = (dir, name, text) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};

test("two copies of the same map have the same checksum, wherever they are; a region changed, added or gone makes another", () => {
  const host = folder();
  const guest = folder();
  const regions = JSON.stringify({ type: "FeatureCollection", features: [{ id: "cz", properties: { owner: "Czechoslovakia" } }] });
  const partsOf = (dir, text) => [
    { name: "regionsGeojson", path: write(dir, "regions.geojson", text) },
    { name: "citiesGeojson", path: null },
    { name: "regions", path: null, sizeOnly: true },
  ];
  const same = mapFingerprint(partsOf(host, regions));
  assert.equal(mapFingerprint(partsOf(guest, regions)), same);
  assert.match(same, /^[0-9a-f]{64}$/);
  const split = regions.replace(`"cz"`, `"cz-1"`);
  assert.notEqual(mapFingerprint(partsOf(guest, split)), same, "the guest's copy has the region the host split");
  // A part present on one side and missing on the other differs too.
  assert.notEqual(mapFingerprint([...partsOf(host, regions).slice(0, 1), { name: "citiesGeojson", path: write(host, "cities.geojson", "{}") }, { name: "regions", path: null, sizeOnly: true }]), same);
});

test("a scenario's own tiles count by their size, and a file read again only when it has changed", () => {
  const dir = folder();
  const tiles = write(dir, "regions.pmtiles", "x".repeat(1000));
  const regions = write(dir, "regions.geojson", "{}");
  const before = mapFingerprint([{ name: "regionsGeojson", path: regions }, { name: "regions", path: tiles, sizeOnly: true }]);
  fs.writeFileSync(tiles, "y".repeat(1000));
  assert.equal(mapFingerprint([{ name: "regionsGeojson", path: regions }, { name: "regions", path: tiles, sizeOnly: true }]), before, "same size");
  fs.writeFileSync(regions, `{"type":"FeatureCollection"}`);
  assert.notEqual(mapFingerprint([{ name: "regionsGeojson", path: regions }, { name: "regions", path: tiles, sizeOnly: true }]), before, "the regions changed");
});
