/*! Open Historia — a scenario's map, by its checksum: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioFingerprint.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scenarioFilesFingerprint } from "./scenarioFingerprint.js";
import { mapLogicFingerprint } from "./mapLogicFingerprint.js";
import { regionFactsOf } from "./regionFacts.js";

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "oh-fingerprint-"));
const write = (dir, name, value) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
};
const region = (id, owner, name = id, coordinates = [[[0, 0], [1, 0], [1, 1], [0, 0]]]) => ({ type: "Feature", id, properties: { name, owner }, geometry: { type: "Polygon", coordinates } });
const map = (...features) => ({ type: "FeatureCollection", features });

test("two copies of the same map have the same checksum, wherever and however they are kept; a region changed, added or gone makes another", () => {
  const host = folder();
  const guest = folder();
  const regions = map(region("cz", "Czechoslovakia"), region("sk", "Czechoslovakia"));
  const same = scenarioFilesFingerprint({ files: { regions: write(host, "regions.geojson", regions) } });
  assert.match(same, /^[0-9a-f]{64}$/);
  // Indented, its features in another order: the same map.
  assert.equal(scenarioFilesFingerprint({ files: { regions: write(guest, "regions.geojson", JSON.stringify(map(region("sk", "Czechoslovakia"), region("cz", "Czechoslovakia")), null, 2)) } }), same);
  // The same regions drawn more lightly (a build that ships a simpler outline): the same world.
  assert.equal(mapLogicFingerprint({ regions: map(region("cz", "Czechoslovakia", "cz", [[[0, 0], [1, 1], [0, 0]]]), region("sk", "Czechoslovakia")) }), mapLogicFingerprint({ regions }));
  // A region split, renamed or given to another: another world.
  for (const other of [
    map(region("cz-1", "Czechoslovakia"), region("cz-2", "Czechoslovakia"), region("sk", "Czechoslovakia")),
    map(region("cz", "Czechoslovakia", "Bohemia"), region("sk", "Czechoslovakia")),
    map(region("cz", "Czechoslovakia"), region("sk", "Slovakia")),
  ]) assert.notEqual(mapLogicFingerprint({ regions: other }), mapLogicFingerprint({ regions }));
  // A part on one side and not the other differs; an empty one is none, as the website answers a missing file.
  assert.notEqual(mapLogicFingerprint({ regions, cities: map({ type: "Feature", properties: { name: "Prague" }, geometry: { type: "Point", coordinates: [14.42, 50.08] } }) }), mapLogicFingerprint({ regions }));
  assert.equal(mapLogicFingerprint({ regions, cities: map() }), mapLogicFingerprint({ regions, cities: null }));
  assert.equal(mapLogicFingerprint({ regions, background: {} }), mapLogicFingerprint({ regions }));
});

// The checksum hashed a region's name and `owner` alone, while the game's catalog takes its starting owner from
// `country` first, then `owner`, reads `gid0`, whether it is land or sea and what it borders: two copies that
// differed only there had one checksum, and a guest drew its own starting owners and seas (the review of
// 2026-11-18, wars 10). One reader serves both (server/regionFacts.js).
test("every fact of a region the game reads counts: its owner as the catalog takes it, land or sea, what it borders", () => {
  const feature = (properties) => ({ type: "Feature", id: "bohemia", properties: { name: "Bohemia", ...properties }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
  const of = (properties) => mapLogicFingerprint({ regions: map(feature(properties)) });
  const base = { country: "Austria", gid0: "AUT", typeId: "land", adjacencies: ["moravia", "saxony"], tags: ["crown"], claimants: [{ polity: "Bavaria", since: 1618 }] };
  const same = of(base);
  for (const [why, changed] of [
    ["another starting owner by country", { ...base, country: "Bohemia" }],
    ["an owner where there was none", { ...base, owner: "" }],
    ["another country code", { ...base, gid0: "CZE" }],
    ["sea, not land", { ...base, typeId: "sea" }],
    ["another border", { ...base, adjacencies: ["moravia"] }],
    ["another tag", { ...base, tags: [] }],
    ["another claimant", { ...base, claimants: [] }],
  ]) assert.notEqual(of(changed), same, why);
  // What is the same, written another way or drawn another way, is the same world.
  assert.equal(of({ ...base, adjacencies: ["saxony", "moravia"] }), same, "borders in any order");
  assert.equal(of({ ...base, claimants: [{ since: 1618, polity: "Bavaria" }] }), same, "an object's keys in any order");
  assert.equal(of({ ...base, centroid: { type: "Point", coordinates: [14.4, 50] } }), same, "where its label sits is not its logic");
  // The catalog reads the same facts by the same reader: its starting owner is `country`, then `owner`.
  assert.deepEqual([regionFactsOf(feature(base)).country, regionFactsOf(feature({ owner: "Saxony" })).country, regionFactsOf(feature({ owner: "Saxony" })).owner], ["Austria", "Saxony", "Saxony"]);
  assert.equal(regionFactsOf({ properties: {} }), null, "no id, no region");
});

test("cities count by name and place to a hundredth of a degree; the background and own basemaps by what they hold", () => {
  const city = (lng) => map({ type: "Feature", properties: { name: "Prague" }, geometry: { type: "Point", coordinates: [lng, 50.08] } });
  assert.equal(mapLogicFingerprint({ cities: city(14.4201) }), mapLogicFingerprint({ cities: city(14.4199) }));
  assert.notEqual(mapLogicFingerprint({ cities: city(14.42) }), mapLogicFingerprint({ cities: city(14.43) }));
  assert.equal(mapLogicFingerprint({ background: { kind: "image", opacity: 0.5 } }), mapLogicFingerprint({ background: { opacity: 0.5, kind: "image" } }));
  assert.notEqual(mapLogicFingerprint({ background: { kind: "image", opacity: 0.5 } }), mapLogicFingerprint({ background: { kind: "image", opacity: 0.6 } }));
});

test("a scenario's own tiles count by their size, and the files are read again only when they have changed", () => {
  const dir = folder();
  const tiles = write(dir, "regions.pmtiles", "x".repeat(1000));
  const regionsFile = write(dir, "regions.geojson", map(region("cz", "Czechoslovakia")));
  const before = scenarioFilesFingerprint({ files: { regions: regionsFile }, tiles: { regions: tiles } });
  fs.writeFileSync(tiles, "y".repeat(1000));
  assert.equal(scenarioFilesFingerprint({ files: { regions: regionsFile }, tiles: { regions: tiles } }), before, "same size");
  fs.writeFileSync(tiles, "y".repeat(1001));
  assert.notEqual(scenarioFilesFingerprint({ files: { regions: regionsFile }, tiles: { regions: tiles } }), before, "another size");
  fs.writeFileSync(tiles, "x".repeat(1000));
  fs.writeFileSync(regionsFile, JSON.stringify(map(region("cz", "Slovakia"))));
  assert.notEqual(scenarioFilesFingerprint({ files: { regions: regionsFile }, tiles: { regions: tiles } }), before, "the regions changed");
});
