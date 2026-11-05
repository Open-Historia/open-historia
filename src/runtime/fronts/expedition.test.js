/*! Open Historia — battlefields and fronts: a war overseas: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

import test from "node:test";
import assert from "node:assert/strict";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const apart = () => syntheticMap({ layout: ["AA~~~~BB", "AA~~~~BB"], legend, west: 20, north: 51, step: 1, stepLat: 0.5 });
const brigade = (id, extra = {}) => ({ id, name: id, type: "infantry", ownerCode: "Aland", strength: 90, lng: 26.5, lat: 50.75, regionId: "r6-0", ...extra });
const fight = (units, extra = {}) => runFronts(frontInput(apart(), { days: 3, units, ...extra }));

test("a war whose sides share no land has no battlefield until one side's troops stand on the other's", () => {
  assert.deepEqual(fight([]).battlefields, []);
  const home = fight([brigade("home", { lng: 20.5, regionId: "r0-0" })]);
  assert.deepEqual(home.battlefields, []);
});

test("troops standing on the enemy's land across the sea open a battlefield there, and are in it", () => {
  const run = fight([brigade("1st Expeditionary"), brigade("2nd Expeditionary", { lng: 27.4, regionId: "r7-0" })]);
  assert.equal(run.battlefields.length, 1);
  const [field] = run.battlefields;
  assert.deepEqual([field.warId, field.status], ["war-1", "active"]);
  assert.deepEqual(field.sides, [["Aland"], ["Borduria"]]);
  assert.ok(field.named.some((entry) => entry.unitId === "1st Expeditionary"), JSON.stringify(field.named));
  assert.ok(run.unitChanges.some((change) => change.unitId === "1st Expeditionary" && change.committedTo), "the brigade is committed to it");
  assert.deepEqual(fight([brigade("1st Expeditionary"), brigade("2nd Expeditionary", { lng: 27.4, regionId: "r7-0" })]), run, "the same turn is the same war");
});

test("ships, aircraft, spies, the committed and those of neither side open nothing", () => {
  for (const unit of [
    brigade("fleet", { type: "naval" }),
    brigade("wing", { type: "air" }),
    brigade("agents", { covert: true }),
    brigade("busy", { committedTo: "Somewhere front" }),
    brigade("neutral", { ownerCode: "Neutralia" }),
  ]) assert.deepEqual(fight([unit]).battlefields, [], unit.id);
});

test("a war that already has a battlefield is left to it", () => {
  const first = fight([brigade("1st Expeditionary")]);
  assert.equal(first.battlefields.length, 1);
  const next = runFronts(frontInput(apart(), { days: 3, battlefields: first.battlefields, fromDate: "2024-03-04", units: [brigade("3rd Expeditionary", { lng: 27.5, lat: 50.25, regionId: "r7-1" })] }));
  assert.equal(next.battlefields.filter((field) => field.status !== "closed").length, 1);
});
