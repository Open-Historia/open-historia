/*! Open Historia — transporters as the map draws them: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/transportFeatures.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTransports, orderTransport } from "../../runtime/fronts/transports.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import { transportFeatures, transportIconId, transportMoves, transportTone } from "./transportFeatures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

const way = [[23.9, 51.5], [26, 51.2], [28.3, 51.5]];
const base = orderTransport([], { medium: "sea", owner: "Aland", to: { lng: 28.4, lat: 51.5, name: "city: Port" }, raise: 12 }, { year: 2024 }).transport;
const moving = { ...base, status: "moving", way, km: 310, gone: 150, load: Array.from({ length: 12 }, () => [100, 0]) };
const drawn = (transports, extra = {}) => transportFeatures({ transports: normalizeTransports(transports), viewer: "Aland", enemies: ["Borduria"], ...extra });

test("a transporter under way is its way and its carrier where it has got to, turned the way it goes", () => {
  const { ways, points } = drawn([moving]);
  assert.deepEqual(ways.features.map((feature) => [feature.properties.what, feature.properties.tone, feature.geometry.coordinates]), [["way", "own", way]]);
  const [carrier] = points.features;
  assert.deepEqual([carrier.properties.what, carrier.properties.icon, carrier.properties.count], ["carrier", "transport-sea-own", "12"]);
  assert.ok(carrier.geometry.coordinates[0] > 25.5 && carrier.geometry.coordinates[0] < 26.5, `at ${carrier.geometry.coordinates}`);
  assert.ok(carrier.properties.bearing > 70 && carrier.properties.bearing < 115, `heading ${carrier.properties.bearing}`);
  // Whose it is decides its colour: the player's own, an enemy's, or anybody else's.
  assert.equal(transportTone({ owner: "aland" }, "Aland", ["Borduria"]), "own");
  assert.equal(transportTone({ owner: "Borduria" }, "Aland", ["Borduria"]), "enemy");
  assert.equal(transportTone({ owner: "Cisland" }, "Aland", ["Borduria"]), "other");
  assert.equal(drawn([{ ...moving, owner: "Borduria" }]).points.features[0].properties.icon, "transport-sea-enemy");
  assert.equal(transportIconId("air", "other"), "transport-air-other");
  // While a turn is being played it is drawn where the playing has brought it, not where it ended.
  const played = drawn([moving], { shown: new Map([["t1", 20]]) }).points.features[0];
  assert.ok(played.geometry.coordinates[0] < 24.5, `played at ${played.geometry.coordinates}`);
});

test("what has ended leaves its way, fainter, and a mark where it was lost; what has not set out is drawn in the war room only", () => {
  const landed = { ...moving, status: "landed", gone: 310, ended: "2024-03-04", at: [28.4, 51.5] };
  const after = drawn([landed]);
  assert.deepEqual(after.ways.features.map((feature) => feature.properties.what), ["wake"]);
  assert.deepEqual(after.points.features, [], "its carrier is gone once its troops are ashore");
  assert.equal(drawn([landed], { shown: new Map([["t1", 200]]) }).points.features[0].properties.what, "carrier", "but it is still drawn while its last stretch is played");
  const lost = drawn([{ ...moving, status: "lost", ended: "2024-03-03", at: [26.1, 51.2] }]);
  assert.deepEqual(lost.points.features.map((feature) => [feature.properties.what, feature.geometry.coordinates]), [["lost", [26.1, 51.2]]]);
  // Ordered and not out: nothing on the map at large.
  const ordered = { ...base, embark: { battlefield: "The front", side: 0, troops: [1, 2] } };
  assert.deepEqual(drawn([ordered]), { ways: { type: "FeatureCollection", features: [] }, points: { type: "FeatureCollection", features: [] } });
  // In the war room: a line to where it was sent, and the way itself once that has been found.
  const straight = drawn([ordered], { planned: true, previews: { t1: { error: "no-sea-way", from: [22, 51] } } });
  assert.deepEqual(straight.ways.features.map((feature) => [feature.properties.what, feature.properties.found, feature.geometry.coordinates]), [["plan", false, [[22, 51], [28.4, 51.5]]]]);
  const found = drawn([ordered], { planned: true, previews: { t1: { way, from: [22, 51] } } });
  assert.deepEqual(found.ways.features.map((feature) => [feature.properties.found, feature.geometry.coordinates]), [[true, way]]);
  assert.deepEqual(found.points.features.map((feature) => [feature.properties.what, feature.geometry.coordinates]), [["plan", [28.3, 51.5]]]);
  // Another country's plans are its own.
  assert.deepEqual(drawn([{ ...ordered, owner: "Borduria" }], { planned: true }).ways.features, []);
  // A way across the date line is one line, not one drawn back round the world.
  const pacific = drawn([{ ...moving, way: [[170, 10], [179, 11], [-178, 12], [-170, 13]], to: { lng: -170, lat: 13 } }]);
  assert.deepEqual(pacific.ways.features[0].geometry.coordinates.map(([lng]) => lng), [170, 179, 182, 190]);
});

test("a turn that has landed is played: each carrier from where it was to where it is, in the days that took it", () => {
  const before = normalizeTransports([{ ...moving, gone: 20 }, { ...base, id: "t2", status: "ordered", embark: { battlefield: "F", side: 0, troops: [1] } }, { ...moving, id: "t3", gone: 150 }]);
  const after = normalizeTransports([
    { ...moving, gone: 310, status: "landed" },
    { ...moving, id: "t2", gone: 240, speed: 60 },
    { ...moving, id: "t3", gone: 150 },
    { ...moving, id: "t4", gone: 90, speed: 720 },
  ]);
  assert.deepEqual(transportMoves(before, after), [
    { id: "t1", from: 20, to: 310, days: 1 },
    { id: "t2", from: 0, to: 240, days: 4 },
    { id: "t4", from: 0, to: 90, days: 1 },
  ], "one that set out this turn is played from the start of its way, and one that did not move is not played");
  assert.deepEqual(transportMoves(null, after).map((move) => move.id), ["t1", "t2", "t3", "t4"]);
  assert.deepEqual(transportMoves(before, []), []);
});

test("the map has the transporters' layers in their place, and the scene mounts them", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const layers = ["transports-way-casing", "transports-way", "transports-icons", "transports-lost"];
  for (const id of layers) assert.ok(index(id) >= 0, `${id} is missing from the map's order`);
  assert.deepEqual([...layers].sort((a, b) => index(a) - index(b)), layers);
  assert.ok(index("transports-way-casing") > index("fronts-troops-name"), "over the troops they sail to");
  assert.ok(index("transports-lost") < index("units-fill"), "and under the world's own formations");
  const component = read("TransportLayers.jsx");
  assert.deepEqual([...component.matchAll(/id="(transports-[a-z-]+)"/g)].map((match) => match[1]), layers, "every layer it declares is in the order, and no other");
  assert.match(read("MapScene.jsx"), /<WarRoomTools \/>\s*<TransportLayers \/>/);
  // The pictures are flat colour, drawn once, and asked for again after a change of style.
  const icons = read("transportIcons.js");
  assert.doesNotMatch(icons, /createLinearGradient|createRadialGradient|gradient\(/i);
  assert.match(component, /map\.on\("styledata", again\);/);
});
