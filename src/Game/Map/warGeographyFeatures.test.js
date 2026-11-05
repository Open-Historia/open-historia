/*! Open Historia — what a scenario draws on its map for war, as the game's map shows it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/warGeographyFeatures.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { kmBetween } from "../../runtime/fronts/worldGrid.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import {
  fortificationFeatures,
  measureLine,
  splitByBreaches,
  terrainAreaFeatures,
  terrainStyleOf,
  wallProgressOn,
  wallWeightOf,
} from "./warGeographyFeatures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8").split("\r\n").join("\n");
// The length of a stretch of points, in km.
const lengthOf = (points) => points.slice(1).reduce((sum, point, index) => sum + kmBetween(points[index][0], points[index][1], point[0], point[1]), 0);
const square = [[[0, 0], [1, 0], [1, 1], [0, 1]]];

test("terrain is shaded darker, and edged harder, the higher its level", () => {
  const styles = Array.from({ length: 11 }, (_, level) => terrainStyleOf(level));
  for (let level = 1; level <= 10; level += 1) {
    for (const key of ["fillOpacity", "lineOpacity", "lineWidth"]) assert.ok(styles[level][key] > styles[level - 1][key], `${key} at ${level}`);
  }
  assert.ok(styles[10].fillOpacity <= 0.32, "translucent even where it can never be crossed");
  assert.deepEqual(terrainStyleOf(14), styles[10]);
  assert.deepEqual(terrainStyleOf(-3), styles[0]);
});

test("terrain areas are polygons with closed rings, the lowest first, and flat ground is not drawn", () => {
  const { features } = terrainAreaFeatures([
    { id: "hills", name: "Hills", level: 3, rings: square },
    { id: "plain", name: "Plain", level: 0, rings: square },
    { id: "peaks", name: "Peaks", level: 9, rings: [[[2, 0], [3, 0], [3, 1], [2, 0]]] },
    { id: "marsh", name: "Marsh", level: 5, rings: square },
    { id: "broken", level: 6, rings: [[[0, 0], [1, 1]]] },
  ]);
  assert.deepEqual(features.map((feature) => [feature.properties.id, feature.properties.level]), [["hills", 3], ["marsh", 5], ["peaks", 9]]);
  assert.deepEqual(features[0].geometry, { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] });
  assert.deepEqual(features[2].geometry.coordinates[0], [[2, 0], [3, 0], [3, 1], [2, 0]], "a ring already closed is left so");
  assert.deepEqual(features[1].properties, { id: "marsh", level: 5, ...terrainStyleOf(5) });
  assert.deepEqual(terrainAreaFeatures(undefined).features, []);
});

test("a wall is cut where it is breached, by kilometres along it from its first point", () => {
  // Two degrees along the equator: some 222 km.
  const line = [[0, 0], [1, 0], [2, 0]];
  const { total } = measureLine(line);
  assert.ok(Math.abs(total - 222.4) < 1);
  const { standing, broken } = splitByBreaches(line, [[50, 80]]);
  assert.equal(standing.length, 2);
  assert.equal(broken.length, 1);
  assert.ok(Math.abs(lengthOf(standing[0]) - 50) < 0.01, "standing up to the breach");
  assert.ok(Math.abs(lengthOf(broken[0]) - 30) < 0.01, "broken through for its 30 km");
  assert.ok(Math.abs(lengthOf(standing[1]) - (total - 80)) < 0.01, "and standing again beyond it");
  assert.deepEqual(standing[1].slice(1), [[1, 0], [2, 0]], "keeping the line's own points");
  assert.deepEqual(standing[0].at(-1), broken[0][0], "the gap starts where the wall stops");
  // Unbroken, broken through end to end, breaches past its end, and breaches that run together.
  assert.deepEqual(splitByBreaches(line, []), { standing: [line], broken: [] });
  assert.deepEqual(splitByBreaches(line, [[0, 500]]).standing, []);
  const past = splitByBreaches(line, [[200, 900]]);
  assert.equal(past.broken.length, 1);
  assert.ok(Math.abs(lengthOf(past.standing[0]) - 200) < 0.01);
  const joined = splitByBreaches(line, [[20, 40], [40, 60], [100, 110]]);
  assert.deepEqual([joined.standing.length, joined.broken.length], [3, 2]);
  assert.ok(Math.abs(lengthOf(joined.broken[0]) - 40) < 0.01);
  // A line across the date line is drawn the short way round.
  const across = splitByBreaches([[179, 10], [-179, 10]], []);
  assert.deepEqual(across.standing[0], [[179, 10], [181, 10]]);
  assert.deepEqual(splitByBreaches([[5, 5]], []), { standing: [], broken: [] });
});

test("a wall being built is so many days along, and stands on the day the engine has it stand", () => {
  assert.equal(wallProgressOn(null, "1941-01-10"), null);
  assert.deepEqual(wallProgressOn({ since: "1941-01-01", days: 30 }, "1941-01-16"), { built: false, share: 0.5 });
  assert.deepEqual(wallProgressOn({ since: "1941-01-01", days: 30 }, "1941-01-30"), { built: false, share: 0.967 });
  assert.deepEqual(wallProgressOn({ since: "1941-01-01", days: 30 }, "1941-01-31"), { built: true, share: 1 });
  assert.deepEqual(wallProgressOn({ since: "1941-01-01", days: 30 }, "1940-12-01"), { built: false, share: 0 });
  // As fronts/walls.js standsOn reads a date the calendar cannot: finished.
  assert.deepEqual(wallProgressOn({ since: "1941-01-01", days: 30 }, ""), { built: true, share: 1 });
});

test("fortified lines: what stands, the rubble of its breaches, and a line being built as far as it has got", () => {
  const lines = [
    { id: "great", name: "The Great Wall", owner: "Aland", level: 8, points: [[0, 0], [2, 0]], breaches: [[50, 80]] },
    { id: "new", name: "The New Line", owner: "Borea", level: 4, points: [[0, 1], [2, 1]], building: { since: "1941-01-01", days: 40 } },
    { id: "done", name: "Done", owner: "Borea", level: 3, points: [[0, 2], [2, 2]], building: { since: "1940-01-01", days: 40 }, breaches: [] },
  ];
  const { features } = fortificationFeatures({ lines, date: "1941-01-11" });
  assert.deepEqual(features.map((feature) => [feature.properties.id, feature.properties.part]), [
    ["great", "wall"], ["great", "rubble"], ["new", "planned"], ["new", "progress"], ["done", "wall"],
  ]);
  for (const feature of features) assert.equal(feature.geometry.type, "MultiLineString");
  assert.equal(features[0].geometry.coordinates.length, 2, "standing either side of its breach");
  assert.ok(Math.abs(lengthOf(features[1].geometry.coordinates[0]) - 30) < 0.01);
  // A quarter of its forty days: a quarter of its length.
  const whole = lengthOf(features[2].geometry.coordinates[0]);
  assert.ok(Math.abs(lengthOf(features[3].geometry.coordinates[0]) - whole / 4) < 0.5);
  assert.equal(features[3].geometry.coordinates[0][0][0], 0, "from its first point");
  // The higher its level, the heavier it is drawn.
  assert.ok(features[0].properties.weight > features[2].properties.weight && features[2].properties.weight > features[4].properties.weight);
  assert.ok(wallWeightOf(10) > wallWeightOf(3));
  // Begun today: planned, with nothing yet built.
  assert.deepEqual(fortificationFeatures({ lines: [lines[1]], date: "1941-01-01" }).features.map((feature) => feature.properties.part), ["planned"]);
  assert.deepEqual(fortificationFeatures().features, []);
});

test("its layers are in the map's order: walls over the borders and under the weather; hard ground is not drawn in the game", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const walls = ["war-walls-rubble", "war-walls-planned", "war-walls-progress", "war-walls-casing", "war-walls-core", "war-walls-teeth"];
  for (const id of walls) assert.ok(index(id) >= 0, `${id} is missing from the map's order`);
  assert.deepEqual([...walls].sort((a, b) => index(a) - index(b)), walls);
  // "The terrain traversability marker should not be visible ingame": no layer of it, in the order or drawn.
  assert.equal(MAP_LAYER_ORDER.some((id) => id.startsWith("war-terrain")), false);
  for (const id of walls) {
    assert.ok(index(id) > index("polity-boundaries") && index(id) > index("group-areas-outline"), "over the borders they so often follow");
    assert.ok(index(id) < index("fronts-weather-wash") && index(id) < index("fronts-arrows-past") && index(id) < index("country-curved-labels"));
  }
  const component = read("WarGeographyLayers.jsx");
  assert.deepEqual([...component.matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]), walls, "every layer it declares is in the order, and no other");
  assert.match(component, /warSettingsOf\(world\)\.mechanics\.walls/);
  assert.doesNotMatch(component, /terrainAreaFeatures|war-terrain/);
  assert.match(component, /"line-offset": wallWidth\(0\.75\)/, "the teeth stand off to one side");
  assert.match(read("MapScene.jsx"), /<IceLayers \/>\s*<WarGeographyLayers \/>/);
  for (const name of ["warGeographyFeatures.js", "WarGeographyLayers.jsx"]) assert.doesNotMatch(read(name), /createLinearGradient|createRadialGradient|createConicGradient|gradient\(/i);
});
