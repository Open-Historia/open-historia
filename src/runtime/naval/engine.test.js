/*! Open Historia — war at sea: what happens when hostile fleets meet: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/naval/engine.test.js
//
// "Now let's do a version of this for navy battles."

import test from "node:test";
import assert from "node:assert/strict";

import { buildWorldGrid } from "../fronts/worldGrid.js";
import { syntheticMap } from "../fronts/syntheticMap.js";
import { BREAKS_UNDER, COMMISSION_LEAST, FITTING_OUT_DAYS, FLEET_KINDS_BY_ERA, NAVAL_REACH_KM, NAVY_REBUILD_DAYS, SUNK_UNDER, navyFactor, runNaval } from "./engine.js";
import { SEA_BATTLE_ROUNDS_KEPT, normalizeNaviesRaised, normalizeSeaBattles, withTurnSeaBattles } from "./record.js";

const war = (extra = {}) => ({ id: "war-1", status: "active", sideA: ["Albion"], sideB: ["Teutonia"], ...extra });
const fleet = (id, name, ownerCode, lng, lat, extra = {}) => ({ id, name, type: "naval", ownerCode, strength: 100, lng, lat, posture: "patrol", ...extra });
// 1914: fleets fight within 600 km of each other.
const run = (units, extra = {}) => runNaval({ fromDate: "1914-08-01", days: 30, seed: "a seed", wars: [war()], units, strengthOf: () => 13, cities: [{ name: "Heligoland", lng: 7.9, lat: 54.2 }], ...extra });
const change = (result, id) => result.unitChanges.find((entry) => entry.unitId === id) ?? null;

test("how far fleets reach, and what a country adds to its fleet, go by the era and by what the country is", () => {
  assert.deepEqual([...NAVAL_REACH_KM], [150, 300, 600, 900]);
  assert.equal(FLEET_KINDS_BY_ERA.length, 4);
  assert.equal(navyFactor(10), 1);
  assert.ok(navyFactor(36) > navyFactor(13) && navyFactor(13) > navyFactor(2));
  assert.equal(navyFactor(1000), 2, "and no further");
});

test("hostile fleets in reach of each other fight: both are worn, the side outweighed loses more and breaks off", () => {
  const result = run([
    fleet("u1", "Grand Fleet", "Albion", 2, 56, { posture: "blockade" }),
    fleet("u2", "High Seas Fleet", "Teutonia", 6, 55, { strength: 50 }),
  ]);
  const [battle] = result.battles;
  assert.ok(battle, "they met");
  assert.equal(battle.place, "off Heligoland");
  assert.equal(battle.warId, "war-1");
  assert.deepEqual(battle.sides, [["Albion"], ["Teutonia"]]);
  assert.equal(battle.winner, 0);
  const [[grand], [high]] = battle.fleets;
  assert.ok(grand.after < grand.before && high.after < high.before, "nobody comes away unmarked");
  assert.ok(high.before - high.after > grand.before - grand.after, "the weaker fleet lost more");
  assert.equal(high.broke, true);
  // What it did to the fleets is written on the fleets: strength, and the beaten one withdrawing.
  assert.deepEqual(change(result, "u1"), { unitId: "u1", strength: grand.after });
  assert.deepEqual(change(result, "u2"), { unitId: "u2", strength: high.after, posture: "withdrawing" });
  // A fleet that broke off fights no more this period: the two do not grind each other away.
  assert.equal(result.battles.length, 1);
  // The same period again is the same battle.
  assert.deepEqual(run([fleet("u1", "Grand Fleet", "Albion", 2, 56, { posture: "blockade" }), fleet("u2", "High Seas Fleet", "Teutonia", 6, 55, { strength: 50 })]), result);
});

test("fleets out of reach, fleets of countries at peace and fleets on a battlefield's books do not fight", () => {
  const far = run([fleet("u1", "Grand Fleet", "Albion", 2, 56), fleet("u2", "Far Squadron", "Teutonia", 120, 30)]);
  assert.deepEqual([far.battles, far.unitChanges], [[], []]);
  const peace = run([fleet("u1", "Grand Fleet", "Albion", 2, 56), fleet("u4", "Neutral Fleet", "Neutralia", 3, 56)]);
  assert.deepEqual(peace.battles, []);
  assert.deepEqual(peace.fleets.map((entry) => entry.name), ["Grand Fleet"], "a fleet of a country at peace is no part of the war at sea");
  const ended = run([fleet("u1", "Grand Fleet", "Albion", 2, 56), fleet("u2", "High Seas Fleet", "Teutonia", 6, 55)], { wars: [war({ status: "ended" })] });
  assert.deepEqual(ended, { battles: [], unitChanges: [], commissioned: [], fleets: [], raised: [], blockades: [] });
  const truce = run([fleet("u1", "Grand Fleet", "Albion", 2, 56), fleet("u2", "High Seas Fleet", "Teutonia", 6, 55)], { wars: [war({ status: "ceasefire" })] });
  assert.deepEqual(truce.battles, []);
  const committed = run([fleet("u1", "Grand Fleet", "Albion", 2, 56), fleet("u2", "High Seas Fleet", "Teutonia", 6, 55, { committedTo: "A front" })]);
  assert.deepEqual(committed.battles, []);
});

test("a fleet that is withdrawing is hard to bring to battle, and one seeking it finds it sooner", () => {
  const met = (postureA, postureB) => {
    let fought = 0;
    for (let index = 0; index < 40; index += 1) {
      const result = runNaval({ fromDate: "1914-08-01", days: 10, seed: `seed ${index}`, wars: [war()], units: [fleet("u1", "A", "Albion", 2, 56, { posture: postureA }), fleet("u2", "B", "Teutonia", 6, 55, { posture: postureB })], strengthOf: () => 13 });
      fought += result.battles.length > 0 ? 1 : 0;
    }
    return fought;
  };
  const seeking = met("assaulting", "patrol");
  const meeting = met("patrol", "patrol");
  const fleeing = met("patrol", "withdrawing");
  assert.ok(seeking > meeting && meeting > fleeing, `${seeking} / ${meeting} / ${fleeing} of 40`);
  assert.ok(fleeing < 24 && seeking >= 30);
});

test("every fleet of the two sides in reach joins, and a fleet beaten down to nothing is gone", () => {
  // Three of Albion's and an ally's against one worn squadron.
  const wars = [war({ sideA: ["Albion", "Gallia"] })];
  const units = [
    fleet("u1", "Grand Fleet", "Albion", 2, 56, { posture: "assaulting" }),
    fleet("u2", "Channel Fleet", "Albion", 3, 55, { posture: "assaulting" }),
    fleet("u3", "Escadre du Nord", "Gallia", 3, 54, { posture: "assaulting" }),
    fleet("u4", "Coastal Squadron", "Teutonia", 6, 55, { strength: 22 }),
  ];
  const result = runNaval({ fromDate: "1914-08-01", days: 12, seed: "a seed", wars, units, strengthOf: () => 13 });
  const [battle] = result.battles;
  assert.deepEqual(battle.sides.map((side) => [...side].sort()), [["Albion", "Gallia"], ["Teutonia"]]);
  assert.equal(battle.fleets[0].length, 3);
  const [squadron] = battle.fleets[1];
  assert.ok(squadron.after <= SUNK_UNDER && squadron.sunk === true, `${squadron.before} to ${squadron.after}`);
  assert.deepEqual(change(result, "u4"), { unitId: "u4", remove: true });
  assert.equal(result.fleets.some((entry) => entry.name === "Coastal Squadron"), false);
  assert.ok(BREAKS_UNDER > SUNK_UNDER);
});

// A sheet with two countries, each with a coast on the sea between them.
const coastal = () => {
  const world = syntheticMap({ layout: ["AAA~~~~BBB", "ALA~~~~BBB", "AAA~~~~BBB", "AAA~~~~BBB"], legend: { A: "Albion", B: "Teutonia", L: "Landlockia", "~": null }, west: 0, north: 54, step: 1, key: "the narrow sea" });
  const grid = buildWorldGrid(world.regions, { step: 0.5 });
  return { world, grid };
};

test("a country at war with a coast and no fleet is given one, in its home waters", () => {
  const { world, grid } = coastal();
  const cities = [{ name: "Alba", lng: 1.5, lat: 53.5, capital: true }, { name: "Teutoburg", lng: 8.5, lat: 51.5, capital: true }];
  const result = runNaval({ fromDate: "1914-08-01", days: 5, seed: "a seed", wars: [war()], units: [], strengthOf: (name) => (name === "Albion" ? 20 : 4), controllerOf: world.controllerOf, grid, cities, caps: { perCountry: 12, world: 80 } });
  assert.deepEqual(result.commissioned.map((unit) => [unit.name, unit.type, unit.ownerCode, unit.composition]), [
    ["Albion Home Fleet", "naval", "Albion", "battleships, cruisers and destroyers"],
    ["Teutonia Home Fleet", "naval", "Teutonia", "battleships, cruisers and destroyers"],
  ]);
  const [mine, theirs] = result.commissioned;
  // On the water, off its own coast; the greater country the greater fleet.
  for (const unit of result.commissioned) {
    const cell = grid.cellOf(unit.lng, unit.lat);
    assert.ok(cell >= 0 && grid.land[cell] < grid.full, `${unit.name} is at sea`);
  }
  assert.ok(mine.lng < 4.5 && theirs.lng > 5.5, `${mine.lng} / ${theirs.lng}`);
  assert.ok(mine.strength > theirs.strength && theirs.strength >= COMMISSION_LEAST);
  // Nobody is given a second one, a country with no coast none, and a country with a fleet already none.
  const again = runNaval({ fromDate: "1914-09-01", days: 5, seed: "a seed", wars: [war()], units: result.commissioned, strengthOf: () => 13, controllerOf: world.controllerOf, grid, cities });
  assert.deepEqual(again.commissioned, []);
  const inland = runNaval({ fromDate: "1914-08-01", days: 5, seed: "a seed", wars: [war({ sideB: ["Landlockia"] })], units: [], strengthOf: () => 13, controllerOf: world.controllerOf, grid, cities });
  assert.deepEqual(inland.commissioned, [], "nobody it could meet at sea: no navy is wanted");
  // The caps on formations hold, and without the sheet nobody is commissioned.
  const army = Array.from({ length: 3 }, (_, index) => ({ id: `a${index}`, name: `Army ${index}`, type: "army", ownerCode: "Albion", strength: 80, lng: 1, lat: 53 }));
  const capped = (caps) => runNaval({ fromDate: "1914-08-01", days: 5, seed: "a seed", wars: [war()], units: army, strengthOf: () => 13, controllerOf: world.controllerOf, grid, cities, caps }).commissioned.map((unit) => unit.ownerCode);
  assert.deepEqual(capped({ perCountry: 12, world: 80 }), ["Albion", "Teutonia"]);
  assert.deepEqual(capped({ perCountry: 3, world: 80 }), ["Teutonia"], "Albion has all the formations a country may");
  assert.deepEqual(capped({ perCountry: 12, world: 4 }), ["Albion"], "and the world has room for one more");
  assert.deepEqual(runNaval({ fromDate: "1914-08-01", days: 5, seed: "a seed", wars: [war()], units: [], strengthOf: () => 13, controllerOf: world.controllerOf, cities }).commissioned, []);
});

test("a new fleet fits out before it fights, and a navy that is gone is not handed back for years", () => {
  const { world, grid } = coastal();
  const input = { seed: "a seed", wars: [war()], strengthOf: () => 13, controllerOf: world.controllerOf, grid };
  // Both are given a fleet, in reach of each other on a sea this narrow: while they fit out there is no battle.
  const first = runNaval({ ...input, fromDate: "1914-08-01", days: FITTING_OUT_DAYS, units: [] });
  assert.equal(first.commissioned.length, 2);
  assert.deepEqual(first.battles, []);
  assert.deepEqual(first.raised, [{ country: "Albion", date: "1914-08-01" }, { country: "Teutonia", date: "1914-08-01" }]);
  assert.ok(runNaval({ ...input, fromDate: "1914-08-01", days: 60, units: [] }).battles.length > 0, "and afterwards they fight");

  // Teutonia's one squadron, a scenario's own, goes down before a fleet that sought it out.
  const grand = fleet("u1", "Grand Fleet", "Albion", 3.75, 52.25, { posture: "assaulting" });
  const sunk = runNaval({ ...input, fromDate: "1914-08-01", days: 20, units: [grand, fleet("u2", "Coastal Squadron", "Teutonia", 6.25, 52.25, { strength: 15 })] });
  assert.deepEqual(change(sunk, "u2"), { unitId: "u2", remove: true });
  assert.deepEqual(sunk.commissioned, [], "it had a navy as the period began");
  const [lost] = sunk.raised;
  assert.deepEqual([sunk.raised.length, lost.country, lost.date], [1, "Teutonia", sunk.battles[0].date], "its years of building begin the day it went down");
  // The turn after, it has no fleet and a coast, and is given nothing; three years on, it is.
  const after = (fromDate, raised) => runNaval({ ...input, fromDate, days: 5, units: [grand], raised }).commissioned.map((unit) => unit.name);
  assert.deepEqual(after("1914-09-01", sunk.raised), []);
  assert.deepEqual(after("1914-09-01", []), ["Teutonia Home Fleet"], "(it is the record that holds it back)");
  assert.deepEqual(after("1916-08-01", sunk.raised), []);
  assert.deepEqual(after("1917-09-01", sunk.raised), ["Teutonia Home Fleet"]);
  assert.ok(NAVY_REBUILD_DAYS >= 365 * 3);
  // The world keeps one line a country, the newest.
  assert.deepEqual(normalizeNaviesRaised([{ country: "Albion", date: "1914-08-01" }, { country: "albion", date: "1915-01-01" }, { country: "" }, null, { country: "Teutonia" }]), [{ country: "albion", date: "1915-01-01" }]);
});

test("a fleet seeking battle closes with the nearest hostile fleet over open water, and one that is not stays where it is", () => {
  const { world, grid } = coastal();
  // A galley age: fleets fight within 150 km, and a degree here is some 65 km across.
  const units = (posture) => [fleet("u1", "Western Fleet", "Albion", 3.25, 52.25, { posture }), fleet("u2", "Eastern Fleet", "Teutonia", 6.75, 52.25, { posture: "holding" })];
  const input = { fromDate: "1200-05-01", days: 1, seed: "a seed", wars: [war()], strengthOf: () => 13, controllerOf: world.controllerOf, grid };
  const before = grid.km(3.25, 52.25, 6.75, 52.25);
  assert.ok(before > NAVAL_REACH_KM[0] && before < NAVAL_REACH_KM[0] * 4);
  const sought = runNaval({ ...input, units: units("assaulting") });
  const moved = sought.fleets.find((entry) => entry.name === "Western Fleet");
  assert.ok(moved.lng > 3.25 && Math.abs(moved.lat - 52.25) < 0.01, "it sailed east");
  assert.ok(grid.km(moved.lng, moved.lat, 6.75, 52.25) < before);
  assert.deepEqual(Object.keys(change(sought, "u1")).filter((key) => key === "lng" || key === "lat"), ["lng", "lat"]);
  const waited = runNaval({ ...input, units: units("patrol") });
  assert.equal(waited.fleets.find((entry) => entry.name === "Western Fleet").lng, 3.25);
  assert.deepEqual(waited.unitChanges, []);
});

test("a fleet that is withdrawing sails for its own coast, and under it is seldom brought to battle", () => {
  const { world, grid } = coastal();
  // A galley age again: 130 km a day, and battle within 150 km.
  const input = { fromDate: "1200-05-01", seed: "a seed", wars: [war()], strengthOf: () => 13, controllerOf: world.controllerOf, grid };
  const far = fleet("u1", "Western Fleet", "Albion", 3.25, 53.75, { posture: "holding" });
  const out = fleet("u2", "Eastern Fleet", "Teutonia", 4.25, 51.25, { posture: "withdrawing" });
  const where = (days) => runNaval({ ...input, days, units: [far, out] }).fleets.find((entry) => entry.name === "Eastern Fleet");
  const [first, second, tenth] = [where(1), where(2), where(10)];
  assert.ok(first.lng > 4.25 && first.lng < second.lng, `${first.lng} / ${second.lng}`);
  assert.deepEqual([second.lng, second.lat], [6.75, 51.25], "the water under its own coast");
  assert.deepEqual([tenth.lng, tenth.lat], [6.75, 51.25], "and there it stays");
  assert.deepEqual(change(runNaval({ ...input, days: 2, units: [far, out] }), "u2"), { unitId: "u2", lng: 6.75, lat: 51.25 });

  // Off its own coast with an enemy patrolling in reach: found far less often than the same fleet on a map with no coast to it.
  const met = (posture, sheet) => {
    let fought = 0;
    for (let index = 0; index < 60; index += 1) {
      const units = [fleet("u1", "Western Fleet", "Albion", 5.25, 51.25), fleet("u2", "Eastern Fleet", "Teutonia", 6.75, 51.25, { posture })];
      fought += runNaval({ ...input, seed: `seed ${index}`, days: 10, units, grid: sheet }).battles.length > 0 ? 1 : 0;
    }
    return fought;
  };
  for (const posture of ["withdrawing", "holding"]) {
    const [sheltered, open] = [met(posture, grid), met(posture, null)];
    assert.ok(sheltered * 2 < open, `${posture}: ${sheltered} / ${open} of 60`);
  }
  // A fleet patrolling its own coast is as easy to find as anywhere.
  assert.ok(Math.abs(met("patrol", grid) - met("patrol", null)) <= 2);
});

test("the world keeps the battles of the last turns for the map to mark, and lets the older go", () => {
  const result = run([fleet("u1", "Grand Fleet", "Albion", 2, 56, { posture: "blockade" }), fleet("u2", "High Seas Fleet", "Teutonia", 6, 55, { strength: 50 })]);
  const kept = withTurnSeaBattles([], result.battles, 4);
  assert.equal(kept.length, 1);
  assert.deepEqual([kept[0].round, kept[0].place, kept[0].winner, kept[0].fleets[1][0].broke], [4, "off Heligoland", 0, true]);
  assert.deepEqual(normalizeSeaBattles(JSON.parse(JSON.stringify(kept))), kept);
  // The same turn applied again is the same battle once; a turn later it is still there, and then it is not.
  assert.equal(withTurnSeaBattles(kept, result.battles, 4).length, 1);
  assert.equal(withTurnSeaBattles(kept, [], 4 + SEA_BATTLE_ROUNDS_KEPT - 1).length, 1);
  assert.equal(withTurnSeaBattles(kept, [], 4 + SEA_BATTLE_ROUNDS_KEPT).length, 0);
  assert.deepEqual(normalizeSeaBattles([{ id: "x" }, null, "y"]), []);
});
