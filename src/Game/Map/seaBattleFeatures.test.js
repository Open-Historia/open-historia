/*! Open Historia — sea battles as the map marks them: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/seaBattleFeatures.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withTurnSeaBattles } from "../../runtime/naval/record.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import { NAVAL_REACH_KM } from "../../runtime/naval/engine.js";
import { BLOCKADE_RING_POINTS, EMPTY_SEA_BATTLE_FEATURES, blockadeFeatures, blockadeTone, seaBattleFeatures, seaBattleTone } from "./seaBattleFeatures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8").split("\r\n").join("\n");

const battle = (extra = {}) => ({
  id: "sea:1914-08-12:0",
  date: "1914-08-12",
  place: "off Heligoland",
  lng: 5,
  lat: 52,
  warId: "war-1",
  sides: [["Albion", "Gallia"], ["Teutonia"]],
  fleets: [[{ name: "Grand Fleet", owner: "Albion", before: 100, after: 88 }], [{ name: "High Seas Fleet", owner: "Teutonia", before: 70, after: 41, broke: true }]],
  winner: 0,
  ...extra,
});

test("a battle is a point where it was fought, with who fought it and when, in the colour of how it went for the player", () => {
  const kept = withTurnSeaBattles([], [battle()], 4);
  const { features } = seaBattleFeatures({ battles: kept, viewer: "Albion" });
  assert.deepEqual(features, [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [5, 52] },
    properties: { id: "sea:1914-08-12:0", tone: "own", label: "Albion, Gallia – Teutonia\n1914-08-12", fresh: true },
  }]);
  // To the other side it was a defeat; to an ally a victory; to anyone else, and where neither had the better of it, neither.
  assert.equal(seaBattleTone(battle(), "Teutonia"), "enemy");
  assert.equal(seaBattleTone(battle(), "gallia"), "own");
  assert.equal(seaBattleTone(battle(), "Neutralia"), "other");
  assert.equal(seaBattleTone(battle(), ""), "other");
  assert.equal(seaBattleTone(battle({ winner: -1 }), "Albion"), "other");
  assert.equal(seaBattleTone(battle({ winner: 1 }), "Albion"), "enemy");
});

test("the newest turn's battles stand out, the turn before's are fainter, and a record with no place is not drawn", () => {
  const first = withTurnSeaBattles([], [battle()], 4);
  const both = withTurnSeaBattles(first, [battle({ id: "sea:1914-09-02:0", date: "1914-09-02", lng: 4, lat: 53 })], 5);
  assert.deepEqual(seaBattleFeatures({ battles: both, viewer: "Albion" }).features.map((feature) => [feature.properties.id, feature.properties.fresh]), [["sea:1914-08-12:0", false], ["sea:1914-09-02:0", true]]);
  assert.deepEqual(seaBattleFeatures({ battles: [{ id: "x" }, null, { id: "", lng: 1, lat: 1 }] }).features, []);
  assert.deepEqual(seaBattleFeatures().features, []);
  assert.deepEqual(EMPTY_SEA_BATTLE_FEATURES.features, []);
});

const blockade = (extra = {}) => ({ country: "Teutonia", by: ["Albion"], pressure: 0.642, covered: 1, days: 45, since: "1914-08-01", ...extra });
const ship = (id, name, ownerCode, lng, lat, extra = {}) => ({ id, name, type: "naval", ownerCode, strength: 90, lng, lat, posture: "blockade", ...extra });

test("a blockade is drawn round the fleets that lay it: the water each closes, and whom it presses on by how much", () => {
  const units = [
    ship("u1", "Grand Fleet", "Albion", 5, 54),
    ship("u2", "Channel Fleet", "Albion", 1, 50, { posture: "patrol" }),
    ship("u3", "High Seas Fleet", "Teutonia", 8, 54),
    ship("u4", "Landing Fleet", "Albion", 4, 53, { committedTo: "The Landing" }),
    { id: "u5", name: "1st Army", type: "army", ownerCode: "Albion", lng: 0, lat: 52, posture: "blockade" },
  ];
  const { rings, labels } = blockadeFeatures({ blockades: [blockade()], units, viewer: "Albion", date: "1914-09-15" });
  // One fleet lays it: the one of a blockading country that is itself in the blockade posture.
  assert.deepEqual(labels.features, [{ type: "Feature", geometry: { type: "Point", coordinates: [5, 54] }, properties: { id: "u1", tone: "own", label: "Teutonia 64%" } }]);
  const [ring] = rings.features;
  assert.deepEqual([rings.features.length, ring.geometry.type, ring.properties.id, ring.properties.tone, ring.geometry.coordinates.length], [1, "LineString", "u1", "own", BLOCKADE_RING_POINTS + 1]);
  assert.deepEqual(ring.geometry.coordinates[0], ring.geometry.coordinates.at(-1).map((value, index) => (Math.abs(value - ring.geometry.coordinates[0][index]) < 1e-9 ? ring.geometry.coordinates[0][index] : value)), "a closed line");
  // As far round it as a fleet of its age reaches: 600 km north of it is 5.39 degrees.
  const north = ring.geometry.coordinates[BLOCKADE_RING_POINTS / 4];
  assert.ok(Math.abs(north[1] - (54 + NAVAL_REACH_KM[2] / 111.32)) < 0.01 && Math.abs(north[0] - 5) < 0.01, String(north));
  const east = ring.geometry.coordinates[0];
  assert.ok(east[0] - 5 > (north[1] - 54) * 1.5, "wider in degrees of longitude, this far north");
  // An age of sail closes less water.
  const sail = blockadeFeatures({ blockades: [blockade()], units, viewer: "Albion", date: "1750-01-01" }).rings.features[0].geometry.coordinates[BLOCKADE_RING_POINTS / 4];
  assert.ok(sail[1] < north[1]);
  // To the country under it, it is the enemy's; to anyone else, somebody's.
  assert.equal(blockadeFeatures({ blockades: [blockade()], units, viewer: "Teutonia" }).labels.features[0].properties.tone, "enemy");
  assert.equal(blockadeFeatures({ blockades: [blockade()], units, viewer: "Neutralia" }).labels.features[0].properties.tone, "other");
  assert.equal(blockadeTone([blockade()], ""), "other");
  // A fleet pressing on two countries says both; on a map laid out flat it is marked, with no ring.
  const both = blockadeFeatures({ blockades: [blockade(), blockade({ country: "Austria", pressure: 0.2 })], units, viewer: "Albion", flat: true });
  assert.equal(both.labels.features[0].properties.label, "Teutonia 64%\nAustria 20%");
  assert.deepEqual(both.rings.features, []);
  // No blockade, or none of its fleets left on the map: nothing.
  assert.deepEqual(blockadeFeatures({ blockades: [], units }), { rings: { type: "FeatureCollection", features: [] }, labels: { type: "FeatureCollection", features: [] } });
  assert.deepEqual(blockadeFeatures({ blockades: [blockade()], units: units.slice(1) }).labels.features, []);
  assert.deepEqual(blockadeFeatures().labels.features, []);
});

test("the blockade's layers are in the map's order too, the ring under the battles and the label over them", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  assert.ok(index("blockades-ring") > index("transports-lost") && index("blockades-ring") < index("seabattles-ring"));
  assert.ok(index("blockades-label") > index("seabattles-label") && index("blockades-label") < index("units-fill"));
  const component = read("SeaBattleLayers.jsx");
  assert.deepEqual([...component.matchAll(/id="(blockades-[a-z-]+)"/g)].map((match) => match[1]), ["blockades-ring", "blockades-label"]);
  assert.ok(component.includes("\"line-dasharray\": [2, 2.4],"));
});

test("its layers are in the map's order, under the fleets' own counters, and the scene mounts it", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const layers = ["seabattles-ring", "seabattles-mark", "seabattles-label"];
  for (const id of layers) assert.ok(index(id) >= 0, `${id} is missing from the map's order`);
  assert.deepEqual([...layers].sort((a, b) => index(a) - index(b)), layers);
  assert.ok(index("seabattles-ring") > index("transports-lost"));
  assert.ok(index("seabattles-label") < index("units-fill"), "under the world's own formations");
  const component = read("SeaBattleLayers.jsx");
  assert.deepEqual([...component.matchAll(/id="(seabattles-[a-z-]+)"/g)].map((match) => match[1]), layers, "every layer it declares is in the order, and no other");
  assert.ok(read("MapScene.jsx").includes("<StrikeLayers />\n      <SeaBattleLayers />"));
  // Flat colour: the map's own three tones and no gradient.
  assert.equal(component.toLowerCase().includes("gradient"), false);
  assert.ok(component.includes("TRANSPORT_TONES.own") && component.includes("TRANSPORT_TONES.enemy") && component.includes("TRANSPORT_TONES.other"));
});
