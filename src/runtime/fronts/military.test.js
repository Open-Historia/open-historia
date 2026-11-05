/*! Open Historia — battlefields and fronts: each country's own military figures: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/military.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { militaryLookup, normalizeMilitaryStats } from "../militaryStats.js";
import { runNaval } from "../naval/engine.js";
import { decodeTroops } from "./codec.js";
import { runFronts } from "./engine.js";
import { MILITARY_NEUTRAL, airWorth, landWorth, mixOf, readMilitary, seaWorth, statFactor } from "./military.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { KIND_ARMOUR, KIND_ARTILLERY } from "./troops.js";

test("a figure of 50 is what every country was before, to the last digit; 0 in an arm is none of it", () => {
  assert.equal(statFactor(50, 0.5, 1.5), 1);
  assert.equal(statFactor(0, 0.5, 1.5), 0.5);
  assert.equal(statFactor(100, 0.5, 1.5), 1.5);
  assert.equal(statFactor(25, 0.5, 1.5), 0.75);
  const neutral = readMilitary(null);
  assert.deepEqual(neutral, { ...MILITARY_NEUTRAL });
  assert.equal(landWorth(neutral), 1);
  assert.equal(seaWorth(neutral), 1);
  assert.equal(airWorth(neutral), 1);
  assert.equal(landWorth(readMilitary({ land: 0, quality: 100 })), 0);
  assert.equal(seaWorth(readMilitary({ sea: 0 })), 0);
  // Elites with good arms fight well beyond a levy with poor ones.
  assert.ok(landWorth(readMilitary({ quality: 90, technology: 80 })) > 2 * landWorth(readMilitary({ quality: 15, technology: 20 })));
  // Out of range is held in range; nonsense is neutral.
  assert.deepEqual(readMilitary({ quality: 250, technology: -4, land: "x", cavalryShare: 2, menPerCounter: 0 }), { ...MILITARY_NEUTRAL, quality: 100, technology: 0 });
  assert.equal(mixOf(neutral), null);
  assert.deepEqual(mixOf(readMilitary({ cavalryShare: 0.9 })), { armour: 0.9, artillery: null });
});

test("military figures as they are kept, and the sheet's standing over the author's, by any of a country's names", () => {
  assert.equal(normalizeMilitaryStats(null), null);
  assert.equal(normalizeMilitaryStats({ quality: "" }), null);
  assert.deepEqual(normalizeMilitaryStats({ quality: 72.6, manpowerShare: 60.04, cavalryShare: 0.9375, menPerCounter: 500.4, sea: 140, bogus: 3, muster: [[0.5, 21], [1, 90]] }),
    { quality: 73, sea: 100, manpowerShare: 60, cavalryShare: 0.938, menPerCounter: 500, muster: [[0.5, 21], [1, 90]] });
  const lookup = militaryLookup({
    polityOverrides: { dothraki: { name: "Dothraki Sea", military: { quality: 70, cavalryShare: 0.9, sea: 0 } } },
    groups: { "Night's Watch": { military: { manpowerShare: 60 } } },
    countryStats: { dothraki: { military: { quality: 75 } } },
  });
  assert.deepEqual(lookup("Dothraki Sea"), { quality: 70, cavalryShare: 0.9, sea: 0 }, "the author's, by its name");
  assert.deepEqual(lookup("dothraki"), { quality: 75, cavalryShare: 0.9, sea: 0 }, "the sheet's over the author's");
  assert.deepEqual(lookup("night's watch"), { manpowerShare: 60 });
  assert.equal(lookup("Westeros"), null);
});

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "military" });
const fixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });
const war = (extra = {}) => frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, staffPolicy: fixed, ...extra });
const troopsOf = (result, side) => decodeTroops(result.battlefields[0].troops[side]).filter((troop) => troop.strength > 0);
const sideOf = (result, name) => result.battlefields[0].sides.findIndex((members) => members[0] === name);

test("a country of better soldiers takes more ground; with the mechanic off nobody's figures count", () => {
  const heldBy = (extra) => {
    let last = null;
    runFronts(war({ ...extra, watch: (seen) => { last = seen.holders; } }));
    return [0, 1].map((side) => last.filter((holder) => holder === side).length);
  };
  const even = heldBy({ mechanics: { military: true }, militaryOf: () => null });
  assert.deepEqual(heldBy({}), even, "neutral figures are no figures");
  const elite = heldBy({ mechanics: { military: true }, militaryOf: (name) => (name === "Aland" ? { quality: 85, technology: 75 } : null) });
  const levy = heldBy({ mechanics: { military: true }, militaryOf: (name) => (name === "Aland" ? { quality: 20 } : null) });
  assert.ok(elite[0] > even[0], `${elite} against ${even}`);
  assert.ok(levy[0] < even[0], `${levy} against ${even}`);
  // Off, the same figures do nothing.
  assert.deepEqual(heldBy({ militaryOf: (name) => (name === "Aland" ? { quality: 85 } : null) }), even);
});

test("a realm too small for a whole counter raises one at part strength, of men it has", () => {
  // Before 1500 a counter is 2,000 men. A thousand people, six in ten fit to fight: 600 men, three tenths of a counter.
  const small = { fromDate: "1400-03-01", mechanics: { military: true }, peopleOf: (name) => (name === "Aland" ? 1000 : 4e6), militaryOf: (name) => (name === "Aland" ? { manpowerShare: 60 } : null), days: 1 };
  const result = runFronts(war(small));
  const aland = troopsOf(result, sideOf(result, "Aland"));
  assert.equal(aland.length, 1, JSON.stringify(aland));
  assert.ok(Math.abs(aland[0].strength - 30) < 2, String(aland[0].strength));
  // Charged the men it raised, and what its reserves sent to make good its losses: never mended past the men it has.
  const charged = result.manpower.find((entry) => entry.name === "Aland");
  assert.ok(charged.drawn >= 600 && charged.drawn <= 650, String(charged.drawn));
  const month = runFronts(war({ ...small, days: 30 }));
  const held = troopsOf(month, sideOf(month, "Aland"));
  assert.ok(held.every((troop) => troop.strength <= 31), JSON.stringify(held.map((troop) => troop.strength)));
  // Without the mechanic, at twelve in a hundred, it had none at all: it was held to whole counters.
  const before = runFronts(war({ ...small, mechanics: {} }));
  assert.equal(troopsOf(before, sideOf(before, "Aland")).length, 0);
  // Its own men a counter: at 500 a counter, one whole and one at a fifth.
  const fivehundred = runFronts(war({ ...small, militaryOf: (name) => (name === "Aland" ? { manpowerShare: 60, menPerCounter: 500 } : null) }));
  const strengths = troopsOf(fivehundred, sideOf(fivehundred, "Aland")).map((troop) => Math.round(troop.strength)).sort((a, b) => a - b);
  assert.equal(strengths.length, 2);
  assert.ok(Math.abs(strengths[0] - 20) < 2 && strengths[1] === 100, JSON.stringify(strengths));
});

test("a country's own unit mix, and a country with no army raises none", () => {
  const counts = (result, name) => {
    const list = troopsOf(result, sideOf(result, name));
    return { n: list.length, armour: list.filter((troop) => troop.kind === KIND_ARMOUR).length, artillery: list.filter((troop) => troop.kind === KIND_ARTILLERY).length };
  };
  const horde = runFronts(war({ days: 1, mechanics: { military: true }, militaryOf: (name) => (name === "Aland" ? { cavalryShare: 0.9, siegeShare: 0 } : null) }));
  const mix = counts(horde, "Aland");
  assert.ok(mix.armour >= Math.floor(mix.n * 0.85) && mix.artillery === 0, JSON.stringify(mix));
  const usual = counts(horde, "Borduria");
  assert.ok(usual.armour < usual.n / 2, "its enemy keeps its era's mix");
  const unarmed = runFronts(war({ days: 1, mechanics: { military: true }, militaryOf: (name) => (name === "Aland" ? { land: 0 } : null) }));
  assert.equal(counts(unarmed, "Aland").n, 0);
});

test("a country with no navy fields no fleet and is given none", () => {
  const fleet = (id, ownerCode, lng, lat) => ({ id, name: id, type: "naval", ownerCode, strength: 100, lng, lat, posture: "patrol" });
  const sea = (extra = {}) => runNaval({ fromDate: "1914-08-01", days: 30, seed: "a seed", wars: [{ id: "war-1", status: "active", sideA: ["Albion"], sideB: ["Teutonia"] }], units: [fleet("u1", "Albion", 2, 56), fleet("u2", "Teutonia", 6, 55)], strengthOf: () => 13, ...extra });
  assert.ok(sea().battles.length > 0, "they meet");
  const landlocked = sea({ militaryOf: (name) => (name === "Teutonia" ? { sea: 0 } : null) });
  assert.deepEqual(landlocked.battles, []);
  assert.deepEqual(landlocked.fleets.map((entry) => entry.name), ["u1"]);
  assert.equal(landlocked.commissioned.length, 0);
});
