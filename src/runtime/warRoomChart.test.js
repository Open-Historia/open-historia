/*! Open Historia — what the war room reads of the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/warRoomChart.test.js
//
// The sea a fleet may be sent to, the water it can reach, the ground a line
// may be built on, and the water off a coast a blockade is laid from: read
// from the same sheet of the map the war at sea is fought on.

import test from "node:test";
import assert from "node:assert/strict";

import { syntheticMap } from "./fronts/syntheticMap.js";
import { buildWorldGrid, kmBetween } from "./fronts/worldGrid.js";
import { regionLocatorOf } from "./regionLocator.js";
import { FLEET_WATER_KM, chartOf } from "./warRoomChart.js";

// Aland in the west with a lake inside it, Borduria in the east with Neutralia
// shut in by it, the sea between, and along the south a land border.
const chartedWorld = () => {
  const world = syntheticMap({
    layout: [
      "AAAA~~~BBBBB",
      "A~AA~~~BNNBB",
      "AAAA~~~BBBBB",
      "AAAABBBBBBBB",
    ],
    legend: { A: "Aland", B: "Borduria", N: "Neutralia", "~": null },
    west: 0,
    north: 54,
    step: 1,
    key: "the charted sea",
  });
  const grid = buildWorldGrid(world.regions, { step: 0.5 });
  return { world, grid, chart: chartOf({ grid, controllerOf: world.controllerOf }) };
};

const SEA = [5.5, 52.5];
const LAKE = [1.5, 52.5];

test("the sea is where a ship may be, and a fleet reaches only the water it is in", () => {
  const { chart } = chartedWorld();
  assert.equal(chart.sea(...SEA), true);
  assert.equal(chart.sea(5.2, 53.8), true);
  assert.equal(chart.sea(2.5, 52.5), false, "Aland's land");
  assert.equal(chart.sea(9.5, 51.5), false, "Borduria's");
  assert.equal(chart.sea(...LAKE), true, "a lake is water too");
  assert.equal(chart.sea(-1.5, 52.5), true, "and so is the open sea past the coast");
  assert.equal(chart.sea(400, 52.5), false, "off the sheet nothing sails");
  // The sea between and the open sea round the land are one water; the lake is its own.
  assert.equal(chart.joins(SEA, [5.2, 51.4]), true);
  assert.equal(chart.joins(SEA, [-1.5, 52.5]), true);
  assert.equal(chart.joins(SEA, LAKE), false, "a fleet at sea cannot sail into a lake");
  assert.equal(chart.joins(LAKE, SEA), false, "nor one on the lake out to sea");
  assert.equal(chart.joins(SEA, [2.5, 52.5]), false, "nor onto land");
  // A fleet the story left in a harbour is in the water nearest it.
  assert.ok(FLEET_WATER_KM >= 60);
  assert.equal(chart.joins([3.8, 52.5], SEA), true);
  // Where nothing says what water a fleet is in, it is not held to any.
  assert.equal(chart.joins([2, 0], SEA), true);
  assert.equal(chart.joins(SEA, null), false);
});

test("a country's ground is the land it holds and no further; water is nobody's", () => {
  const { chart } = chartedWorld();
  assert.equal(chart.holds("Aland", 2.5, 53.5), true);
  assert.equal(chart.holds(" aland ", 0.5, 50.5), true);
  assert.equal(chart.holds("Aland", 9.5, 51.5), false, "Borduria's land");
  assert.equal(chart.holds("Borduria", 9.5, 51.5), true);
  assert.equal(chart.holds("Neutralia", 8.5, 52.5), true);
  assert.equal(chart.holds("Aland", ...SEA), null, "the sea");
  assert.equal(chart.holds("Aland", ...LAKE), null, "and a lake");
  assert.equal(chart.holds("Aland", 400, 52.5), null, "and what is off the sheet");
  assert.equal(chart.holds("", 2.5, 53.5), false);
  // Not a step past the land border.
  assert.equal(chart.holds("Aland", 3.9, 50.5), true);
  assert.equal(chart.holds("Aland", 4.1, 50.5), false);
  assert.equal(chart.holds("Borduria", 4.1, 50.5), true);
  assert.equal(chart.holds("Aland", 6.5, 50.5), false);
  // A group holds the land of its area.
  const { grid, world } = chartedWorld();
  const grouped = chartOf({ grid, controllerOf: world.controllerOf, groupOf: (id) => (id === "r9-2" ? "The Free Company" : "") });
  assert.equal(grouped.holds("The Free Company", 9.5, 51.5), true);
  assert.equal(grouped.holds("The Free Company", 2.5, 53.5), false);
});

test("with the regions' own shapes, a country's ground ends where the map draws its border, not where the sheet's cells fall", () => {
  // Two countries split by a border that runs aslant across the sheet's cells, and a lake in the west.
  const regions = [
    { id: "west", geometry: { type: "Polygon", coordinates: [[[0, 50], [2, 50], [1, 52], [0, 52], [0, 50]], [[0.2, 50.2], [0.4, 50.2], [0.4, 50.4], [0.2, 50.4], [0.2, 50.2]]] } },
    { id: "east", geometry: { type: "Polygon", coordinates: [[[2, 50], [3, 50], [3, 52], [1, 52], [2, 50]]] } },
  ];
  const owners = { west: "Aland", east: "Borduria" };
  const grid = buildWorldGrid(regions, { step: 0.5 });
  const exact = chartOf({ grid, controllerOf: (id) => owners[id], locate: regionLocatorOf(regions) });
  // At 50.8 N the border is at 1.6 E: a few kilometres either side of it, in one cell of the sheet.
  assert.equal(exact.holds("Aland", 1.55, 50.8), true);
  assert.equal(exact.holds("Aland", 1.65, 50.8), false);
  assert.equal(exact.holds("Borduria", 1.65, 50.8), true);
  assert.equal(exact.holds("Aland", 0.3, 50.3), null, "the lake is nobody's");
  // The sheet alone says it by the cell: for the cell the border runs through, one side or the other.
  const rough = chartOf({ grid, controllerOf: (id) => owners[id] });
  assert.notEqual(rough.holds("Aland", 1.55, 50.8) && rough.holds("Borduria", 1.65, 50.8), true);
});

test("a blockade is laid from open water off the coast, the stretch nearest the fleet in the fleet's own water", () => {
  const { chart } = chartedWorld();
  const station = chart.coastOff("Borduria", SEA);
  assert.ok(station, "Borduria has a coast on the sea between");
  assert.equal(chart.sea(...station), true);
  assert.equal(chart.joins(SEA, station), true);
  assert.ok(station[0] > 6.4 && station[0] < 7, `off Borduria's western coast, nearest the fleet: ${station}`);
  assert.ok(kmBetween(SEA[0], SEA[1], station[0], station[1]) < 120);
  // From a fleet in the south of the sea, the stretch of coast nearest it.
  const south = chart.coastOff("Borduria", [5.5, 51.6]);
  assert.ok(south && south[1] > 51 && south[1] < 52, `the coast to the south: ${south}`);
  // A country with no coast, or none on the fleet's water, cannot be blockaded from it.
  assert.equal(chart.coastOff("Neutralia", SEA), null);
  assert.equal(chart.coastOff("Borduria", LAKE), null, "a fleet on the lake reaches no coast of Borduria's");
  const lakeside = chart.coastOff("Aland", LAKE);
  assert.ok(lakeside && chart.joins(LAKE, lakeside), "but Aland's own shore of it");
  assert.equal(chart.coastOff("Nowhere", SEA), null);
  assert.equal(chart.coastOff("", SEA), null);
  // With no fleet to measure from, any of its coast.
  assert.ok(chart.coastOff("Borduria", null));
});

test("no sheet, no chart", () => {
  assert.equal(chartOf({ grid: null, controllerOf: () => "" }), null);
  const { grid } = chartedWorld();
  assert.equal(chartOf({ grid }), null);
});
