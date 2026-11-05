/*! Open Historia — the war room's fortified lines and fleets as shapes for the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/warRoomMarks.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { kmBetween } from "../../runtime/fronts/worldGrid.js";
import { FLEET_COLOURS, LINE_COLOURS, fleetFeatures, lineColour, lineFeatures, ringAround, stillBuilding } from "./warRoomMarks.js";

const what = (collection) => collection.features.map((feature) => feature.properties.what);

test("a line is coloured by its level, and the colours are flat and of no purple", () => {
  assert.deepEqual(Object.keys(LINE_COLOURS).map(Number), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(Object.values(LINE_COLOURS)).size, 8, "a colour a level");
  for (const colour of [...Object.values(LINE_COLOURS), ...Object.values(FLEET_COLOURS)]) assert.match(colour, /^#[0-9a-f]{6}$/);
  assert.equal(lineColour(1), LINE_COLOURS[3]);
  assert.equal(lineColour(12), LINE_COLOURS[10]);
  assert.equal(lineColour("x"), LINE_COLOURS[5]);
});

test("a line stands once it is built, and is drawn broken until then; the line drawn and not yet ordered is dotted", () => {
  const lines = [
    { id: "a", name: "The Old Wall", owner: "Borduria", level: 7, points: [[9, 53], [9, 51]] },
    { id: "b", name: "", owner: "Aland", level: 4, points: [[1, 53], [2, 53]], building: { since: "1914-08-01", days: 30 } },
    { id: "c", owner: "Aland", level: 5, points: [[1, 52]] },
  ];
  assert.equal(stillBuilding(lines[1], "1914-08-30"), true);
  assert.equal(stillBuilding(lines[1], "1914-08-31"), false);
  assert.equal(stillBuilding(lines[0], "1914-08-01"), false);
  const drawn = lineFeatures({ lines, draft: [[3, 50], [3.5, 50.5]], level: 9, player: "aland", date: "1914-08-10" });
  assert.deepEqual(what(drawn), ["line", "building", "draft"], "a line of one point is no line");
  assert.deepEqual(drawn.features.map((feature) => feature.properties.own), [false, true, true]);
  assert.deepEqual(drawn.features.map((feature) => feature.properties.colour), [LINE_COLOURS[7], LINE_COLOURS[4], LINE_COLOURS[9]]);
  assert.deepEqual(drawn.features.map((feature) => feature.properties.label), ["The Old Wall", "", ""]);
  assert.deepEqual(what(lineFeatures({ lines, date: "1915-01-01" })), ["line", "line"], "built by then, and nothing drawn");
});

test("a fleet has its ring, a patrol its station, and a move its arrow, the one picked out brighter", () => {
  const fleets = [
    { id: "u1", lng: 5.5, lat: 52.5, order: { kind: "patrol", toLng: 5.2, toLat: 51.6, radiusKm: 150 } },
    { id: "u2", lng: 5.5, lat: 52.5, order: { kind: "move", toLng: -1.5, toLat: 52.5 } },
    { id: "u3", lng: 178, lat: 10, order: { kind: "move", toLng: -178, toLat: 10 } },
    { id: "u4", lng: 1, lat: 1, order: null },
    { id: "u5", lng: "x", lat: 1 },
  ];
  const drawn = fleetFeatures({ fleets, picked: "u2" });
  assert.deepEqual(what(drawn), ["fleet", "station", "fleet", "course", "head", "fleet", "course", "head", "fleet"]);
  const lit = drawn.features.filter((feature) => feature.properties.lit).map((feature) => feature.properties.what);
  assert.deepEqual(lit, ["fleet", "course", "head"]);
  assert.equal(drawn.features[2].properties.colour, FLEET_COLOURS.picked);
  assert.equal(drawn.features[0].properties.colour, FLEET_COLOURS.fleet);
  // The station's ring lies its radius out all round.
  const ring = drawn.features[1].geometry.coordinates;
  assert.deepEqual(ring[0], ring.at(-1), "closed");
  for (const [lng, lat] of ring) assert.ok(Math.abs(kmBetween(5.2, 51.6, lng, lat) - 150) < 1);
  // A course across the date line goes the short way.
  const [from, to] = drawn.features[6].geometry.coordinates;
  assert.deepEqual([from, to], [[178, 10], [182, 10]]);
  assert.equal(ringAround(0, 0, 0)[0][0], 0);
});
