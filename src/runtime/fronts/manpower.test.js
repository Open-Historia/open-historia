/*! Open Historia — battlefields and fronts: the men a country's troops are raised from: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/manpower.test.js
//
// "Manpower & Recruitment: Military recruitment directly draws from and
// reduces the available population pool."

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "./codec.js";
import { MANPOWER_SHARE, MEN_PER_FORMATION_BY_ERA, REINFORCE_ORDER } from "./constants.js";
import { runFronts } from "./engine.js";
import { menPerFormation, shareOf } from "./manpower.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 53, step: 1, stepLat: 0.5, key: "manpower" });
const live = (record, side) => decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0);
// (2024: a formation is ten thousand men.)
const MEN = menPerFormation(3);
const people = (table) => (name) => table[name] ?? 0;
const run = (extra = {}) => runFronts(frontInput(sheet(), { days: 0, ...extra }));
const ledger = (result, name) => result.manpower.find((entry) => entry.name === name) ?? { drawn: 0, returned: 0 };

test("a formation is so many men, by era, and a country can have a share of its people under arms", () => {
  assert.deepEqual([...MEN_PER_FORMATION_BY_ERA], [2000, 5000, 12000, 10000]);
  assert.deepEqual([menPerFormation(0), menPerFormation(3), menPerFormation(9), menPerFormation(undefined)], [2000, 10000, 10000, 2000]);
  assert.equal(MANPOWER_SHARE, 0.12);
  assert.equal(MEN, 10000);
});

test("troops raised are drawn from the people of the country they are", () => {
  const result = run({ peopleOf: people({ Aland: 60e6, Borduria: 40e6 }) });
  const [record] = result.battlefields;
  const [mine, theirs] = [live(record, 0).length, live(record, 1).length];
  assert.ok(mine >= 12 && theirs >= 12);
  assert.deepEqual(result.manpower, [{ name: "Aland", drawn: mine * MEN, returned: 0 }, { name: "Borduria", drawn: theirs * MEN, returned: 0 }]);
  // A country whose people nobody knows is charged nothing, and raises what it always did.
  const unknown = run({ peopleOf: people({ Aland: 60e6 }) });
  assert.deepEqual(unknown.manpower.map((entry) => entry.name), ["Aland"]);
  assert.equal(live(unknown.battlefields[0], 1).length, theirs);
  // And a run that is told nothing of anybody's people charges nobody.
  assert.deepEqual(run().manpower, []);
  assert.deepEqual(run({ peopleOf: people({ Aland: 60e6, Borduria: 40e6 }), manpower: false }).manpower, []);
});

test("a country cannot raise what it does not have: a small people fields a small army", () => {
  // Three hundred thousand people: thirty-six thousand fit to serve, which is three formations.
  const result = run({ peopleOf: people({ Aland: 60e6, Borduria: 300000 }) });
  const [record] = result.battlefields;
  assert.equal(live(record, 1).length, Math.floor((MANPOWER_SHARE * 300000) / MEN));
  assert.equal(ledger(result, "Borduria").drawn, 3 * MEN);
  // The other side is not held by that.
  assert.ok(live(record, 0).length >= 12);
});

test("a draft is held to the men there are, and says so when there are none", () => {
  const opened = run({ peopleOf: people({ Aland: 60e6, Borduria: 300000 }) });
  const [record] = opened.battlefields;
  const order = (side) => [{ day: 1, type: "order", battlefield: record.name, side, order: REINFORCE_ORDER, sector: "all", count: 10, given: true, ref: 4 }];
  const told = { peopleOf: people({ Aland: 60e6, Borduria: 300000 }), battlefields: [record], days: 2 };
  // Borduria has every man it can raise under arms already.
  const none = run({ ...told, moments: order("Borduria") });
  assert.equal(live(none.battlefields[0], 1).length, live(record, 1).length);
  assert.deepEqual(none.notes.map((note) => [note.kind, note.side]), [["reinforce-no-men", "Borduria"]]);
  // Aland has millions: ten formations come, and a hundred thousand men are drawn for them.
  const some = run({ ...told, moments: order("Aland") });
  assert.equal(live(some.battlefields[0], 0).length, live(record, 0).length + 10);
  // (And a few more, for the men its reserves sent in those two days.)
  const drawn = ledger(some, "Aland").drawn;
  assert.ok(drawn >= 10 * MEN && drawn < 10 * MEN + 2000, `${drawn} men`);
  assert.deepEqual(some.notes, []);
});

test("the men who come home are given back: a war that ends costs a country only those it lost", () => {
  const known = people({ Aland: 60e6, Borduria: 40e6 });
  const attack = [{ day: 0, type: "order", battlefield: "The front", side: "Aland", order: "advance", sector: "all" }];
  // A month of fighting: troops are lost, and reserves are sent to make them good.
  const fought = runFronts(frontInput(sheet(), { days: 30, peopleOf: known, moments: attack }));
  const [record] = fought.battlefields;
  const raised = live(run({ peopleOf: known }).battlefields[0], 0).length;
  assert.ok(ledger(fought, "Aland").drawn > raised * MEN, "the men its reserves sent are recruits too");
  assert.equal(ledger(fought, "Aland").returned, 0);
  // The war ends next period: the battlefield closes and whoever is still on it goes home.
  const ended = runFronts(frontInput(sheet(), {
    days: 3, fromDate: "2024-03-31", peopleOf: known, battlefields: [record],
    wars: [{ id: "war-1", title: "aland-war", status: "ended", sideA: ["Aland"], sideB: ["Borduria"] }],
  }));
  assert.equal(ended.battlefields[0].status, "closed");
  const serving = (side) => live(record, side).reduce((sum, troop) => sum + troop.strength, 0);
  for (const [name, side] of [["Aland", 0], ["Borduria", 1]]) {
    assert.equal(ledger(ended, name).returned, Math.round((serving(side) / 100) * MEN), name);
    assert.equal(ledger(ended, name).drawn, 0);
  }
  // Over the whole war Aland drew more men than came home: the difference is what it lost.
  assert.ok(ledger(fought, "Aland").drawn - ledger(ended, "Aland").returned > 0);
});

test("the armies a scenario begins with are part of the population its author gave: building them charges nobody", () => {
  const built = run({ peopleOf: people({ Aland: 60e6, Borduria: 300000 }), authored: [] });
  assert.deepEqual(built.manpower, []);
  assert.ok(live(built.battlefields[0], 1).length >= 12, "and nothing holds them to what is fit to serve");
});

// "I set a deploy line, it says I have no manpower, check and have plenty" (a player, 2026-10-28): the AI rated the
// army a country keeps (the United Kingdom 4, Ireland 1), and it was read as every man the country could call up.
test("a country's men to call up are never fewer than the scenario's share, whatever its own figure says", () => {
  const rated = (manpowerShare, scenario = 0) => shareOf({ mech: { military: true }, militaryOf: () => ({ manpowerShare }), manpowerShare: scenario }, "Ireland");
  assert.equal(rated(1), MANPOWER_SHARE);
  assert.equal(rated(4), MANPOWER_SHARE);
  assert.equal(rated(60), 0.6, "a warrior people, more");
  assert.equal(rated(1, 0.05), 0.05, "the scenario's own share");
  assert.equal(rated(null), MANPOWER_SHARE);
  assert.equal(shareOf({ mech: {}, militaryOf: () => ({ manpowerShare: 60 }), manpowerShare: 0 }, "Ireland"), MANPOWER_SHARE, "figures not weighed");
});
