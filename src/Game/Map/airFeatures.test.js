/*! Open Historia — aircraft over the battlefields: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/airFeatures.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { AIR_MOST_A_SIDE, airPlanesOf } from "./airFeatures.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";

const frame = { lng0: 20, lat0: 50, cell: 0.1, cols: 60, rows: 40, km: 7 };
const troops = (count, x0) => Array.from({ length: count }, (_, at) => ({ x: x0 + (at % 5), y: 4 + at, strength: 80 }));
const target = (air, sides = [["Aland"], ["Borduria"]]) => ({
  record: { name: "The Border", sides, frame, brief: { air } },
  view: { troops: [troops(12, 10), troops(9, 30)] },
});

test("each side's wings are a few aircraft, over its own troops or the other side's, in the tone of whose they are", () => {
  const { features } = airPlanesOf([target({ holds: 0, wings: [9, 2], missions: ["support", "strike"] })], { mine: "Aland" });
  const own = features.filter((feature) => feature.properties.tone === "own");
  const enemy = features.filter((feature) => feature.properties.tone === "enemy");
  assert.equal(own.length, AIR_MOST_A_SIDE, "a few, however many wings");
  assert.equal(enemy.length, 2);
  // Aland's support flies over its own troops (west), Borduria's strike over Aland's too.
  for (const feature of [...own, ...enemy]) assert.ok(feature.geometry.coordinates[0] < 20 + 0.1 * 22, JSON.stringify(feature.geometry.coordinates));
  for (const feature of features) assert.ok(feature.properties.heading >= 0 && feature.properties.heading < 360);
});

test("wings kept on the ground, a battlefield with no sky held, and nobody's troops to fly over are not drawn", () => {
  assert.equal(airPlanesOf([target({ holds: 0, wings: [4, 3], missions: ["grounded", "grounded"] })]).features.length, 0);
  assert.equal(airPlanesOf([target(null)]).features.length, 0);
  assert.equal(airPlanesOf([{ ...target({ holds: 0, wings: [4, 0], missions: ["support", "support"] }), view: { troops: [[], []] } }]).features.length, 0);
  // A war the player is no part of: another's.
  const { features } = airPlanesOf([target({ holds: 1, wings: [0, 3], missions: ["support", "support"] })], { mine: "Ruritania" });
  assert.deepEqual([...new Set(features.map((feature) => feature.properties.tone))], ["other"]);
});

test("they circle: the same moment is the same place, a later one another", () => {
  const sky = [target({ holds: 0, wings: [3, 0], missions: ["support", "support"] })];
  assert.deepEqual(airPlanesOf(sky, { seconds: 5 }), airPlanesOf(sky, { seconds: 5 }));
  assert.notDeepEqual(airPlanesOf(sky, { seconds: 5 }).features[0].geometry, airPlanesOf(sky, { seconds: 9 }).features[0].geometry);
});

test("the aircraft have their place on the map, over the troops and the transporters", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const declared = [...fs.readFileSync(new URL("./AirLayers.jsx", import.meta.url), "utf8").matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(declared, ["fronts-air-shadow", "fronts-air"]);
  for (const id of declared) assert.ok(index(id) > index("fronts-troops") && index(id) > index("transports-icons"), id);
  assert.ok(index("fronts-air-shadow") < index("fronts-air"));
});
