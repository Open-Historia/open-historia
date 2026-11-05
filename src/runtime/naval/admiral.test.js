/*! Open Historia — war at sea: an admiral for the countries nobody plays: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/naval/admiral.test.js
//
// "Make it also be able to control and understand fortifications, fleets and
// blockades" (the owner, 2026-10-14).

import test from "node:test";
import assert from "node:assert/strict";

import { buildWorldGrid } from "../fronts/worldGrid.js";
import { syntheticMap } from "../fronts/syntheticMap.js";
import { ADMIRAL_POSTURES, chooseFleetPostures } from "./admiral.js";
import { runNaval } from "./engine.js";

const war = (extra = {}) => ({ id: "war-1", status: "active", sideA: ["Albion"], sideB: ["Teutonia"], ...extra });
const fleet = (id, name, ownerCode, lng, lat, extra = {}) => ({ id, name, type: "naval", ownerCode, strength: 100, lng, lat, posture: "patrol", ...extra });
// Albion in the west, Teutonia in the east, and the sea between.
const narrowSea = () => {
  const world = syntheticMap({ layout: ["AAA~~~~BBBNN", "AAA~~~~BBBNN", "AAA~~~~BBBNN", "AAA~~~~BBBNN"], legend: { A: "Albion", B: "Teutonia", N: "Neutralia", "~": null }, west: 0, north: 54, step: 1, key: "the narrow sea" });
  return { world, grid: buildWorldGrid(world.regions, { step: 0.5 }) };
};
const input = (units, { world, grid }, extra = {}) => ({
  fromDate: "1914-08-01", days: 30, seed: "a seed", wars: [war()], units, strengthOf: () => 13, controllerOf: world.controllerOf, grid,
  raised: [{ country: "Albion", date: "1914-07-01" }, { country: "Teutonia", date: "1914-07-01" }], ...extra,
});

test("an admiral blockades a coast nobody defends, and leaves a person's fleets and those the story ordered alone", () => {
  const sheet = narrowSea();
  const units = [fleet("f1", "Grand Fleet", "Albion", 6.2, 52.5)];
  const { units: told, chosen } = chooseFleetPostures(input(units, sheet));
  assert.equal(chosen.get("f1"), "blockade");
  assert.equal(told[0].posture, "blockade");
  assert.equal(units[0].posture, "patrol", "what it was handed is not changed");
  // Fought with what it chose, Teutonia is blockaded; left on patrol, it is not.
  const laid = (result) => result.blockades.find((entry) => entry.country === "Teutonia") ?? null;
  assert.ok(laid(runNaval(input(told, sheet)))?.pressure > 0);
  assert.equal(laid(runNaval(input(units, sheet))), null);
  // A person's fleet is that person's, and one the story gave orders to this turn keeps them.
  assert.equal(chooseFleetPostures(input(units, sheet), { players: ["Albion"] }).chosen.size, 0);
  assert.equal(chooseFleetPostures(input(units, sheet), { kept: new Set(["f1"]) }).chosen.size, 0);
  // The same input, the same choice.
  assert.deepEqual([...chooseFleetPostures(input(units, sheet)).chosen], [...chosen]);
});

test("an admiral whose fleet is outmatched does not seek battle, and keeps more of it than patrolling would", () => {
  const sheet = narrowSea();
  const units = [fleet("big", "Grand Fleet", "Albion", 4.6, 52.5, { posture: "assaulting" }), fleet("small", "High Seas Fleet", "Teutonia", 6.4, 52.5, { strength: 45 })];
  const { units: told, chosen } = chooseFleetPostures(input(units, sheet), { players: ["Albion"] });
  const posture = told.find((unit) => unit.id === "small").posture;
  assert.ok(ADMIRAL_POSTURES.includes(posture));
  assert.notEqual(posture, "assaulting");
  const left = (result) => result.fleets.find((entry) => entry.id === "small")?.strength ?? 0;
  assert.ok(left(runNaval(input(told, sheet))) >= left(runNaval(input(units, sheet))), `${posture}: ${left(runNaval(input(told, sheet)))} against ${left(runNaval(input(units, sheet)))} patrolling`);
  assert.equal(chosen.has("big"), false, "Albion is played");
});
