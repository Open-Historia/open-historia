/*! Open Historia — the army that took one city goes on to the next: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/storyMarch.test.js
//
// "it seems sometimes events to do with war aren't being represented on the
// map" (a player, 2026-11). Replayed offline, his 2003 skip took Basra with
// the three formations standing in Kuwait and then refused Baghdad, a month
// later, with "0 of the 1 a region that size needs": the formations that had
// just marched into Basra were still counted where they stood before the
// answer, and were spent. Read in order, they stand where they marched.

import test from "node:test";
import assert from "node:assert/strict";

import { createApplicationReceipt } from "../../runtime/applicationReceipt.js";
import { marchStoryCapturers } from "./storyMarch.js";

// Two squares of land half a degree wide, the second 3 degrees east of the first.
const square = (id, name, west) => {
  const ring = [[west, 30], [west + 0.5, 30], [west + 0.5, 30.5], [west, 30.5], [west, 30]];
  return { id, name, geometry: { type: "Polygon", coordinates: [ring] }, bbox: [west, 30, west + 0.5, 30.5], centroid: [west + 0.25, 30.25] };
};
const context = { rows: [square("r-port", "Port", 40), square("r-capital", "Capital", 43)], resolveOwner: (name) => name };
const formation = (id, lng) => ({ id, name: `Division ${id}`, ownerCode: "Aland", type: "infantry", lng, lat: 30.25 });
const capture = (regionId, title, date) => ({ event: { title, date }, path: title, impacts: { regionControlOps: [{ op: "control", regionId, fromCode: "Borduria", toCode: "Aland", basis: "occupation" }] } });

test("formations that took the port in one event are near the capital in the next, and take it", () => {
  // One formation, just west of the port: it takes the port, and then the capital, 300 km on.
  const world = { units: [formation("a", 39.6)] };
  const containers = [capture("r-port", "The port falls", "2003-03-21"), capture("r-capital", "The capital falls", "2003-04-09")];
  const receipt = createApplicationReceipt();
  marchStoryCapturers(containers, world, { receipt, context });
  assert.equal(containers[0].impacts.regionControlOps.length, 1, "the port is taken");
  assert.equal(containers[1].impacts.regionControlOps.length, 1, "the capital is taken too");
  const intoCapital = containers[1].impacts.unitOps.filter((op) => op.op === "move");
  assert.ok(intoCapital.length >= 1);
  assert.ok(intoCapital.every((op) => op.toLng >= 43 && op.toLng <= 43.5), "they march on into the capital");
  assert.ok(!(receipt.notes ?? []).some((note) => note.kind === "dropped"));
});

test("from where they marched, not from where they stood: a capital beyond reach of their old place is in reach of the port", () => {
  // Over 800 km from the capital where it stands, about 600 km once in the port.
  const far = { ...context, rows: [square("r-port", "Port", 40), square("r-capital", "Capital", 46)] };
  const world = { units: [formation("a", 37.6)] };
  const containers = [capture("r-port", "The port falls", "2003-03-21"), capture("r-capital", "The capital falls", "2003-04-09")];
  marchStoryCapturers(containers, world, { receipt: null, context: far });
  assert.equal(containers[0].impacts.regionControlOps.length, 1);
  assert.equal(containers[1].impacts.regionControlOps.length, 1, "the capital is within reach of the port");
});

test("within one event a formation still goes to one region only, and too few still take nothing", () => {
  const world = { units: [formation("a", 39.6)] };
  const both = { event: { title: "Both fall", date: "2003-03-21" }, path: "both", impacts: { regionControlOps: [
    { op: "control", regionId: "r-port", fromCode: "Borduria", toCode: "Aland" },
    { op: "control", regionId: "r-capital", fromCode: "Borduria", toCode: "Aland" },
  ] } };
  const receipt = createApplicationReceipt();
  marchStoryCapturers([both], world, { receipt, context });
  assert.deepEqual(both.impacts.regionControlOps.map((op) => op.regionId), ["r-port"]);
  assert.ok((receipt.notes ?? []).some((note) => note.kind === "dropped" && /could not take Capital/.test(note.text)));
});
