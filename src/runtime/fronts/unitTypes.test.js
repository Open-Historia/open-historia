/*! Open Historia — battlefields and fronts: a scenario's own unit types in the fighting: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/unitTypes.test.js
//
// "so like a dragon troop that is an air troop and super strong and very tough" (the owner, 2026-11-13). A formation
// of one of the scenario's own unit types (runtime/unitTypes.js) fights by its type's figures: in the sky over a
// battlefield, on the battlefield, in an air strike and at sea.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "./codec.js";
import { runFronts } from "./engine.js";
import { enlarge, frontInput, syntheticMap } from "./syntheticMap.js";
import { resolveAirStrikes } from "./airStrike.js";
import { runNaval } from "../naval/engine.js";

const DRAGON = { id: "dragon", name: "Dragon", base: "air", attack: 5, toughness: 4, speed: 2, icon: "🐉", note: "", owners: [] };
const ELEPHANTS = { id: "war-elephants", name: "War Elephants", base: "armor", attack: 5, toughness: 3, speed: 2, icon: "🐘", note: "", owners: [] };
const KRAKEN = { id: "kraken", name: "Kraken", base: "naval", attack: 3, toughness: 3, speed: 1, icon: "🐙", note: "", owners: [] };

// ---- the sky over a battlefield (air.js) ----------------------------------------------------------------

const airSheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend: { A: "Aland", B: "Borduria" }, west: 20, north: 52, step: 1, stepLat: 0.5, key: "unit-types-air" });
const holdFixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });
const wing = (id, ownerCode, extra = {}) => ({ id, name: id, type: "air", ownerCode, strength: 60, lng: ownerCode === "Aland" ? 21 : 27, lat: 51, ...extra });
const skies = (units, extra = {}) => {
  const result = runFronts(frontInput(airSheet(), { arenas: new Map(), staff: true, troops: 1, days: 6, strengthOf: () => 4, staffPolicy: holdFixed, mechanics: { air: true }, units, ...extra }));
  const record = result.battlefields[0];
  const aland = record.sides.findIndex((members) => members[0] === "Aland");
  return { result, sky: record.brief.air, aland };
};

test("a dragon wins the sky over a battlefield that an ordinary wing of the same strength would only contest", () => {
  const contested = skies([wing("aland-wing", "Aland"), wing("borduria-wing", "Borduria")]);
  assert.equal(contested.sky.superiority, 0, "two ordinary wings of one strength hold the sky alike");

  const dragon = skies([wing("aland-wing", "Aland", { unitType: "dragon" }), wing("borduria-wing", "Borduria")], { unitTypes: [DRAGON] });
  assert.equal(dragon.sky.holds, dragon.aland, "Aland's dragon holds the sky");
  assert.ok(dragon.sky.superiority > 0.6, `and holds it by far: ${dragon.sky.superiority}`);
  // Whichever side flies it.
  const theirs = skies([wing("aland-wing", "Aland"), wing("borduria-wing", "Borduria", { unitType: "dragon" })], { unitTypes: [DRAGON] });
  assert.equal(theirs.sky.holds, 1 - theirs.aland, "Borduria's dragon holds it");
  assert.ok(theirs.sky.superiority > 0.6);

  // It is worn its toughness times less, and the wing it beat the more.
  const worn = (run, id) => 60 - (run.result.unitChanges.find((change) => change.unitId === id)?.strength ?? 60);
  assert.ok(worn(dragon, "aland-wing") > 0 && worn(dragon, "aland-wing") * 3 < worn(contested, "aland-wing"), `${worn(dragon, "aland-wing")} against ${worn(contested, "aland-wing")}`);
  assert.ok(worn(dragon, "borduria-wing") > worn(contested, "borduria-wing"));

  // Without the scenario's types, the same units fight as they always did, to the last digit.
  const named = skies([wing("aland-wing", "Aland", { unitType: "dragon" }), wing("borduria-wing", "Borduria")]);
  assert.deepEqual(named.result, contested.result);
});

test("a dragon flies where the era has no aircraft, and for a country whose figures give it no air arm", () => {
  // 1200: no ordinary wing reaches anything.
  const ordinary = skies([wing("aland-wing", "Aland"), wing("borduria-wing", "Borduria")], { era: 0 });
  assert.equal(ordinary.sky, undefined, "nothing flies before there were aircraft");
  const dragon = skies([wing("aland-wing", "Aland", { unitType: "dragon" }), wing("borduria-wing", "Borduria")], { era: 0, unitTypes: [DRAGON] });
  assert.equal(dragon.sky?.holds, dragon.aland, "a dragon does");
  assert.deepEqual(dragon.sky.wings, dragon.aland === 0 ? [1, 0] : [0, 1], "alone in the sky");
  // A country with no air arm flies its dragon all the same, as any country's.
  const grounded = { mechanics: { air: true, military: true }, militaryOf: (name) => (name === "Aland" ? { air: 0 } : null) };
  assert.equal(skies([wing("aland-wing", "Aland")], grounded).sky, undefined);
  const flown = skies([wing("aland-wing", "Aland", { unitType: "dragon" })], { ...grounded, unitTypes: [DRAGON] });
  assert.equal(flown.sky?.holds, flown.aland);
});

// ---- on the battlefield (battle.js, dawn.js) ---------------------------------------------------------------

const landSheet = () => syntheticMap({
  layout: enlarge(["AAABBB", "AAABBB", "AAABBB", "AAABBB", "~~~~~~"], 2),
  legend: { A: "Aland", B: "Borduria", "~": null },
  west: 20,
  north: 52,
  step: 0.25,
  cities: [{ name: "Alba", lng: 20.6, lat: 51.4, capital: true }, { name: "Brod", lng: 23.3, lat: 51.2, capital: true }],
});
const tanks = (extra = {}) => ({ id: "unit-1", name: "1st Guards", type: "armor", ownerCode: "Aland", strength: 80, lng: 21.1, lat: 51.3, ...extra });
const advance = [{ day: 0, type: "order", battlefield: "Aland - Borduria front", side: "Aland", order: "advance", sector: "all" }];
// The named troop of each day as the recorder is handed it, and Borduria's strength at the end.
const fight = (world, extra = {}) => {
  const days = [];
  const result = runFronts(frontInput(world, {
    days: 8,
    moments: advance,
    watch: (seen) => {
      const troop = seen.troops[0].find((entry) => entry.named);
      if (troop) days.push({ day: seen.day, punch: troop.punch, guard: troop.guard, legs: troop.legs });
    },
    ...extra,
  }));
  const record = result.battlefields[0];
  const borduria = record.sides.findIndex((members) => members[0] === "Borduria");
  const left = decodeTroops(record.troops[borduria]).reduce((sum, troop) => sum + troop.strength, 0);
  return { result, record, days, left };
};

test("a troop of the scenario's own land type hits harder, every day, with or without the newer mechanics", () => {
  const world = landSheet();
  const plain = fight(world, { units: [tanks()] });
  const typed = fight(world, { units: [tanks({ unitType: "war-elephants" })], unitTypes: [ELEPHANTS] });
  assert.equal(typed.record.named.length, 1, "taken in as a named troop");
  // With none of the newer mechanics no morning sets a troop's figures: it fights by its type's all the same.
  for (const day of typed.days) assert.deepEqual([day.punch, day.guard, day.legs], [5, 3, 2], `day ${day.day}`);
  for (const day of plain.days) assert.deepEqual([day.punch, day.guard, day.legs], [1, 1, 1]);
  assert.ok(typed.left < plain.left, `Borduria has less left facing elephants: ${typed.left} against ${plain.left}`);

  // With them, each morning's figures are its type's times what the day makes of any troop.
  const mechanics = { mechanics: { fatigue: true, weather: true }, climateSeed: "seed" };
  const plainMorning = fight(world, { units: [tanks()], ...mechanics });
  const typedMorning = fight(world, { units: [tanks({ unitType: "war-elephants" })], unitTypes: [ELEPHANTS], ...mechanics });
  const first = (run) => run.days.find((day) => day.day === 1);
  assert.ok(Math.abs(first(typedMorning).punch / first(plainMorning).punch - 5) < 1e-9, `${first(typedMorning).punch} against ${first(plainMorning).punch}`);
  assert.ok(Math.abs(first(typedMorning).guard / first(plainMorning).guard - 3) < 1e-9);
  assert.ok(Math.abs(first(typedMorning).legs / first(plainMorning).legs - 2) < 1e-9);

  // Without the scenario's types the same unit is an ordinary troop, to the last digit.
  assert.deepEqual(fight(world, { units: [tanks({ unitType: "war-elephants" })] }).result, plain.result);
});

test("a battlefield read back from its record fights its typed troop by its type's figures again", () => {
  const world = landSheet();
  const opened = fight(world, { units: [tanks({ unitType: "war-elephants" })], unitTypes: [ELEPHANTS] });
  const committed = [tanks({ unitType: "war-elephants", committedTo: opened.record.name })];
  const next = fight(world, { battlefields: opened.result.battlefields, units: committed, unitTypes: [ELEPHANTS], fromDate: "2024-03-09", moments: [] });
  assert.equal(next.record.named.length, 1);
  assert.ok(next.days.length > 0);
  for (const day of next.days) assert.deepEqual([day.punch, day.guard, day.legs], [5, 3, 2], `day ${day.day}`);
});

// ---- the war room's air strikes (airStrike.js) -------------------------------------------------------------

test("a dragon's raid bombs harder and loses less to the fighters that rise against it", () => {
  const strike = (unitTypes) => resolveAirStrikes({
    orders: [{ id: "s1", unit: "raider", owner: "Aland", kind: "city", lng: 22, lat: 51, target: "Brod", country: "Borduria", people: 100000, date: "1940-05-01", round: 1 }],
    units: [
      { id: "raider", name: "Raiders", type: "air", ownerCode: "Aland", strength: 80, lng: 21, lat: 51, ...(unitTypes ? { unitType: "dragon" } : {}) },
      { id: "guard", name: "Guards", type: "air", ownerCode: "Borduria", strength: 80, lng: 22.5, lat: 51, composition: "fighters" },
    ],
    wars: [{ id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Borduria"] }],
    // (A seed whose dice have the fighters find the raid.)
    seed: "b",
    era: 3,
    date: "1940-05-01",
    ...(unitTypes ? { unitTypes } : {}),
  });
  const plain = strike(null);
  const dragon = strike([DRAGON]);
  const [ordinary] = plain.strikes;
  const [typed] = dragon.strikes;
  assert.ok(ordinary.intercepted.length > 0 && typed.intercepted.length > 0, "the fighters rose both times");
  assert.ok(typed.lost < ordinary.lost, `the dragon lost less: ${typed.lost} against ${ordinary.lost}`);
  assert.ok(typed.power > ordinary.power * 4, `and its bombs weigh its attack: ${typed.power} against ${ordinary.power}`);
  assert.ok(typed.intercepted[0].lost > ordinary.intercepted[0].lost, "the fighters that rose against it lost more");
});

// ---- at sea (naval/engine.js) --------------------------------------------------------------------------------

test("a fleet of the scenario's own naval type fights harder and takes less", () => {
  const fleet = (id, ownerCode, lng, lat, extra = {}) => ({ id, name: id, type: "naval", ownerCode, strength: 80, lng, lat, posture: "assaulting", ...extra });
  const sea = (units, extra = {}) => runNaval({ fromDate: "1914-08-01", days: 30, seed: "a seed", wars: [{ id: "war-1", status: "active", sideA: ["Albion"], sideB: ["Teutonia"] }], units, strengthOf: () => 13, ...extra });
  const plain = sea([fleet("albion", "Albion", 2, 56), fleet("teutonia", "Teutonia", 6, 55)]);
  const kraken = sea([fleet("albion", "Albion", 2, 56, { unitType: "kraken" }), fleet("teutonia", "Teutonia", 6, 55)], { unitTypes: [KRAKEN] });
  const [ordinary] = plain.battles;
  const [typed] = kraken.battles;
  assert.ok(ordinary && typed, "they met both times");
  const loss = (battle, side) => battle.fleets[side][0].before - battle.fleets[side][0].after;
  assert.equal(typed.winner, 0, "the kraken's side won");
  assert.ok(loss(typed, 0) < loss(ordinary, 0) / 2, `it lost less: ${loss(typed, 0)} against ${loss(ordinary, 0)}`);
  assert.ok(loss(typed, 1) > loss(ordinary, 1), `and the other fleet more: ${loss(typed, 1)} against ${loss(ordinary, 1)}`);
  // Without the scenario's types the same fleets fight as they always did.
  assert.deepEqual(sea([fleet("albion", "Albion", 2, 56, { unitType: "kraken" }), fleet("teutonia", "Teutonia", 6, 55)]), plain);
});
