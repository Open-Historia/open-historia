/*! Open Historia — battlefields and fronts: a staff calls up troops: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/callUp.test.js
//
// "make it so the war engine makes other countries reinforce more, it doesnt seem like they almost ever
// reenforce/deploy troops" (a player, 2026-11-10). A side nobody plays had fresh formations only when the story
// wrote it an order for them; now its own staff calls them up when it needs them (engine.js staffCallUp, staff.js
// callUpNeed), within its men, what it is short of and the game's difficulty, and goes for its capital when the
// other side holds it.

import test from "node:test";
import assert from "node:assert/strict";

import { DIFFICULTY_EDGES, STAFF_CALL_UP_CEILING, STAFF_CALL_UP_DAYS, STAFF_CALL_UP_MOBILISE, STAFF_CALL_UP_THIN } from "./constants.js";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const layout = ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"];
const sheet = (cities = []) => syntheticMap({ layout, legend, west: 20, north: 53, step: 1, stepLat: 0.5, key: `call-up-${cities.length}`, cities });
const fight = ({ aland = 2, borduria = 1.8, days = 75, players = [], callUps = true, cities = [], battlefields = undefined, fromDate = undefined, shortageOf = undefined, difficulty = undefined } = {}) => {
  const world = sheet(cities);
  const result = runFronts(frontInput(world, {
    arenas: new Map(), days, staff: true, callUps, players, seed: "a seed",
    strengthOf: (name) => (name === "Aland" ? aland : borduria),
    ...(battlefields ? { battlefields, fromDate } : {}),
    ...(shortageOf ? { shortageOf } : {}),
    ...(difficulty ? { difficulty } : {}),
  }));
  const calls = (result.staffCalls ?? []);
  return { result, record: result.battlefields[0], calls, called: result.news.filter((entry) => entry.k === "mobilised") };
};

test("an outmatched side nobody plays calls up a share of its army each month, and says so", () => {
  const out = fight();
  const mine = out.calls.filter((call) => call.side === "Borduria");
  assert.ok(mine.length >= 2, `${mine.length} call-ups in 75 days`);
  assert.equal(mine[0].why, "thin", "outmatched on its first day");
  assert.ok(mine.every((call) => ["thin", "losing", "mobilise"].includes(call.why) && call.came > 0 && call.came <= call.asked));
  // A month apart at the least.
  assert.ok(mine.every((call, at) => at === 0 || Date.parse(call.d) - Date.parse(mine[at - 1].d) >= STAFF_CALL_UP_DAYS * 864e5));
  // Told as its own staff's decision, in fresh formations along its whole line.
  const told = out.called.filter((entry) => entry.s === 1);
  assert.ok(told.length === mine.length && told.every((entry) => /^\d+ fresh formations along its whole line$/.test(entry.at)));
  // When it last called up is kept, and the next run waits out the month.
  const last = mine.at(-1).d;
  assert.equal(out.record.brief.carry.mobilised[1], last);
  const again = fight({ days: 5, battlefields: [out.record], fromDate: out.record.asOf });
  assert.equal(again.calls.filter((call) => call.side === "Borduria").length, 0, "not again within the month");
  assert.ok(STAFF_CALL_UP_THIN < STAFF_CALL_UP_MOBILISE);
});

test("nobody calls up for a side a person plays, nor when a run is told the numbers are the story's", () => {
  assert.equal(fight({ players: ["Borduria"] }).calls.filter((call) => call.side === "Borduria").length, 0);
  assert.equal(fight({ callUps: false }).calls.length, 0);
});

test("a side whose capital is at stake mobilises harder, short of what it lacks, and never past its ceiling", () => {
  const capital = [{ name: "Brodgrad", lng: 24.6, lat: 51.5, capital: true, population: 900000 }];
  const threatened = fight({ cities: capital, days: 2 });
  const plain = fight({ days: 2 });
  const [first] = threatened.calls.filter((call) => call.side === "Borduria");
  const [usual] = plain.calls.filter((call) => call.side === "Borduria");
  assert.equal(first.why, "mobilise", "the other side stands within reach of its capital");
  assert.ok(first.asked > usual.asked * 2, `${first.asked} against ${usual.asked}`);
  // Short of supplies, war weariness or a blockade, it calls up the fewer.
  const short = fight({ cities: capital, days: 2, shortageOf: (name) => (name === "Borduria" ? 0.5 : 0) });
  // (Its reserves are the fewer for it too: SHORTAGE_EDGE.)
  assert.ok(short.calls[0].asked >= 1 && short.calls[0].asked <= Math.ceil(first.asked * 0.5), `${short.calls[0].asked} against ${first.asked}`);
  // The game's difficulty: fighting a person's country on Hard it has the reserves Hard gives.
  const hard = fight({ cities: capital, days: 2, players: ["Aland"], difficulty: "hard" });
  const [onHard] = hard.calls.filter((call) => call.side === "Borduria");
  assert.ok(onHard.asked > first.asked, `${onHard.asked} against ${first.asked} (reserves ${DIFFICULTY_EDGES.hard.reserves})`);
  // A long war: never past STAFF_CALL_UP_CEILING times what its strength raises there, however long.
  const long = fight({ cities: capital, days: 240 });
  const usualArmy = Math.round(first.asked / STAFF_CALL_UP_MOBILISE);
  const live = long.record.brief.strength[1].n;
  assert.ok(live <= Math.ceil(usualArmy * STAFF_CALL_UP_CEILING) + 1, `${live} formations, against an army of about ${usualArmy}`);
});

test("a side whose capital the other holds goes for it at the odds of a fight, where it would otherwise hold", async () => {
  const { staffDecision } = await import("./staff.js");
  // The decision itself, on a battle that stands so: its capital held, at odds it would only hold at.
  const fakeBattle = {
    troops: [[{ strength: 100, kind: 0, supply: 1, punch: 1, x: 1, y: 1 }], [{ strength: 80, kind: 0, supply: 1, punch: 1, x: 3, y: 1 }]],
    quality: [1, 1],
    edge: [{ power: 1 }, { power: 1 }],
    homeSide: Int8Array.from([-1, 1]),
    arena: { cities: [{ name: "Brodgrad", cell: 2, capital: true, population: 1, x: 2.5, y: 0.5 }], region: Uint16Array.from([0, 1, 1, 1]) },
    field: { size: 4, cols: 4, holders: Uint8Array.from([0, 0, 0, 1]) },
    place: { kmAt: () => 10 },
  };
  assert.deepEqual(staffDecision(fakeBattle, 1, {}), { order: "advance", sector: "city: Brodgrad", ratio: 0.8 });
  // Its capital its own again, at the same odds it holds.
  fakeBattle.field.holders[2] = 1;
  assert.equal(staffDecision(fakeBattle, 1, {}).order, "hold");
});

test("the story is told what a staff called up, as its own staff's decision", async () => {
  const { describePeriod } = await import("../../Game/AI/frontPrompt.js");
  const record = { name: "The front", status: "active", sides: [["Aland"], ["Borduria"]], brief: {} };
  const text = describePeriod({ record, news: [{ d: "2024-04-01", k: "mobilised", s: 1, at: "9 fresh formations along its whole line" }] });
  assert.equal(text, "  This period, by date: 2024-04-01 Borduria called up 9 fresh formations along its whole line, on its own staff's decision.");
});
