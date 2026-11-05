/*! Open Historia — the war room's planned movements as shapes: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/warRoomGeometry.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_COLOURS, arrowHead, planFeatures, planTone, smoothWay } from "./warRoomGeometry.js";

const plan = (extra = {}) => ({ id: "order:0", kind: "order", order: "advance", ways: [[[30, 50], [31, 50]]], ...extra });

test("a plan is drawn in the colour of whose it is and what kind", () => {
  assert.equal(planTone(plan()), "own");
  assert.equal(planTone(plan({ kind: "route" })), "own");
  assert.equal(planTone(plan({ kind: "diversion" })), "decoy");
  assert.equal(planTone(plan({ kind: "project", live: true })), "project");
  assert.equal(planTone(plan({ kind: "project", live: false })), "idle", "an operation that moves nothing yet is fainter");
  assert.equal(planTone(plan({ project: "project-1" })), "project", "an operation that has been sent stands among the orders, in its colour");
  assert.equal(planTone(plan({ kind: "diversion" }), { theirs: true }), "known", "what is known of theirs is all one colour: nothing says which is true");
  assert.equal(planTone(plan({ kind: "deploy" })), "deploy", "where new troops come in: a colour of its own");
  assert.equal(new Set(Object.values(PLAN_COLOURS)).size, 6);
});

test("a way has its corners cut and keeps its ends", () => {
  const way = [[30, 50], [31, 50], [31, 51]];
  const smooth = smoothWay(way);
  assert.deepEqual(smooth[0], [30, 50]);
  assert.deepEqual(smooth[smooth.length - 1], [31, 51]);
  assert.ok(smooth.length > way.length);
  assert.ok(!smooth.some(([lng, lat]) => lng === 31 && lat === 50), "the corner itself is gone");
  for (const [lng, lat] of smooth) assert.ok(lng >= 30 && lng <= 31 && lat >= 50 && lat <= 51);
  assert.deepEqual(smoothWay([[30, 50], [31, 50]]), [[30, 50], [31, 50]], "two points are a straight line already");
});

test("the head of an arrow points where its way ends", () => {
  const east = arrowHead([[30, 50], [32, 50]]);
  assert.deepEqual(east[0], [32, 50]);
  assert.deepEqual(east[3], east[0], "a closed ring");
  assert.ok(east[1][0] < 32 && east[2][0] < 32, "its base is behind its point");
  assert.ok(Math.abs(east[1][1] - 50 - (50 - east[2][1])) < 1e-9, "and lies evenly to either side");
  const north = arrowHead([[30, 50], [30, 52]]);
  assert.ok(north[1][1] < 52 && north[2][1] < 52);
  // The last stretch may be too short to have a direction: the one before it gives it.
  assert.ok(arrowHead([[30, 50], [32, 50], [32, 50]]));
  assert.equal(arrowHead([[30, 50]]), null);
  assert.equal(arrowHead([[30, 50], [30, 50]]), null);
  // A long arrow's head is no bigger than a head may be.
  const long = arrowHead([[0, 50], [60, 50]]);
  assert.ok(60 - long[1][0] < 1, "held to a most");
});

test("the plans of both sides become lines, heads and names", () => {
  const collection = planFeatures({
    plans: [
      plan(),
      plan({ id: "project:p1", kind: "project", live: true, name: "Operation Kingfisher", ways: [[[30, 50], [31, 50.5], [32, 50]], [[30, 50], [31, 49.5], [32, 50]]] }),
      plan({ id: "d1", kind: "diversion", ways: [[[30, 49], [33, 49]]] }),
      plan({ id: "order:3", order: "dig in", ways: [] }),
    ],
    known: [plan({ id: "known:0", ways: [[[34, 50], [33, 50]]] })],
    pointed: "d1",
    labelOf: (entry) => entry.name ?? "",
  });
  assert.equal(collection.type, "FeatureCollection");
  const of = (what) => collection.features.filter((feature) => feature.properties.what === what);
  assert.equal(of("way").length, 5, "a line a way: two for the operation's two columns, none for troops that stay");
  assert.equal(of("head").length, 5);
  assert.deepEqual(of("name").map((feature) => [feature.properties.label, feature.geometry.type]), [["Operation Kingfisher", "Point"]], "its name once, not once a column");
  assert.deepEqual(of("way").map((feature) => feature.properties.tone), ["own", "project", "project", "decoy", "known"]);
  assert.deepEqual(of("way").map((feature) => feature.properties.pointed), [false, false, false, true, false]);
  assert.deepEqual(of("way").map((feature) => feature.properties.decoy), [false, false, false, true, false]);
  for (const feature of of("way")) assert.equal(feature.properties.colour, PLAN_COLOURS[feature.properties.tone]);
  for (const feature of of("head")) assert.equal(feature.geometry.type, "Polygon");
  // A movement time has passed over is being made, or has been: its arrow is
  // off the map, unless it is the one the panel points at.
  const past = [plan({ id: "order:5", begun: true }), plan({ id: "project:p2", kind: "project", done: true, ways: [] }), plan({ id: "order:6" })];
  assert.deepEqual(planFeatures({ plans: past }).features.filter((feature) => feature.properties.what === "way").map((feature) => feature.properties.plan), ["order:6"]);
  assert.deepEqual(planFeatures({ plans: past, pointed: "order:5" }).features.filter((feature) => feature.properties.what === "way").map((feature) => feature.properties.plan), ["order:5", "order:6"]);
  assert.equal(planTone(plan({ kind: "project", live: true, done: true })), "idle", "an operation that has been carried out is no longer bright");
  // What is known of the other side's is drawn whatever its age.
  assert.equal(planFeatures({ known: [plan({ id: "known:1", begun: true })] }).features.filter((feature) => feature.properties.what === "way").length, 1);
  assert.deepEqual(planFeatures().features, []);
  assert.deepEqual(planFeatures({ plans: [plan({ ways: [[[30, 50]]] })] }).features, [], "a way of one point is no way");
});
