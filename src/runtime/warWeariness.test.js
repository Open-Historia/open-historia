/*! Open Historia — war weariness: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/warWeariness.test.js
//
// "A peace offer the player accepts or declines, with war weariness."

import test from "node:test";
import assert from "node:assert/strict";

import {
  WEARINESS_ALL_GROUND_LOST,
  WEARINESS_A_YEAR,
  WEARINESS_BLOCKADE_A_YEAR,
  WEARINESS_GROUND_TAKEN,
  WEARINESS_MOST,
  WEARINESS_PEACE_A_YEAR,
  WEARINESS_PERIOD_MOST,
  WEARINESS_PER_SHARE_CALLED,
  WEARY_FROM,
  WEARY_SHORTAGE_MOST,
  countriesAtWar,
  normalizeWarWeariness,
  shortagesTogether,
  wearinessAfter,
  wearinessGoingIn,
  wearinessOf,
  wearinessWord,
  wearyShortage,
  withTurnWeariness,
} from "./warWeariness.js";

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} against ${expected}`);
const WAR = { id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Borduria", "Cisland"] };

test("a country at war grows weary with time, with the men it calls up, the ground it loses and a blockade", () => {
  near(wearinessAfter({ before: 10, days: 365, atWar: true }), 10 + WEARINESS_A_YEAR, "a year of a quiet war");
  near(wearinessAfter({ before: 0, days: 30, atWar: true }), (WEARINESS_A_YEAR * 30) / 365);
  // Calling up one in a hundred of its people.
  near(wearinessAfter({ before: 0, days: 0, atWar: true, called: 0.01 }), WEARINESS_PER_SHARE_CALLED * 0.01);
  // Losing a tenth of what it held.
  near(wearinessAfter({ before: 0, days: 0, atWar: true, lost: 0.1 }), WEARINESS_ALL_GROUND_LOST * 0.1);
  // A year under a blockade that cuts half its trade.
  near(wearinessAfter({ before: 0, days: 365, atWar: true, blockade: 0.5 }), WEARINESS_A_YEAR + WEARINESS_BLOCKADE_A_YEAR * 0.5);
  // Victories are borne more easily: ground taken gives some of it back, never below nothing.
  near(wearinessAfter({ before: 20, days: 0, atWar: true, taken: 0.5 }), 20 - WEARINESS_GROUND_TAKEN * 0.5);
  assert.equal(wearinessAfter({ before: 2, days: 0, atWar: true, taken: 1 }), 0);
  // One terrible month is held to what a month can do, and nothing goes past the top.
  assert.equal(wearinessAfter({ before: 0, days: 30, atWar: true, called: 0.5, lost: 1 }), WEARINESS_PERIOD_MOST);
  assert.equal(wearinessAfter({ before: 90, days: 30, atWar: true, lost: 1 }), WEARINESS_MOST);
  // Nonsense in is nothing in.
  near(wearinessAfter({ before: "x", days: 365, atWar: true, called: -3, lost: NaN, blockade: 9 }), WEARINESS_A_YEAR + WEARINESS_BLOCKADE_A_YEAR);
});

test("in peace it falls away", () => {
  near(wearinessAfter({ before: 70, days: 365, atWar: false }), 70 - WEARINESS_PEACE_A_YEAR);
  assert.equal(wearinessAfter({ before: 5, days: 365, atWar: false }), 0);
  // (What happened to it in the period counts for nothing once it is at peace.)
  near(wearinessAfter({ before: 70, days: 365, atWar: false, lost: 1, called: 1 }), 70 - WEARINESS_PEACE_A_YEAR);
});

test("a turn moves every country's weariness: those at war by what the turn did to them, the rest toward nothing", () => {
  const people = { aland: 1e7, borduria: 5e6 };
  const held = { aland: 20, borduria: 10, cisland: 4 };
  const turn = (kept, extra = {}) => withTurnWeariness(kept, {
    days: 30,
    wars: [WAR],
    manpower: [{ name: "Aland", drawn: 150000, returned: 50000 }, { name: "Borduria", drawn: 20000, returned: 60000 }, { name: "Cisland", drawn: 9000, returned: 0 }],
    peopleOf: (name) => people[name.toLowerCase()] ?? 0,
    flips: [{ kind: "control", regionId: "r1", from: "Borduria", to: "Aland" }, { kind: "control", regionId: "r2", from: "Borduria", to: "Aland" }, { kind: "groupTake", regionId: "r3", from: "Borduria", to: "Rebels" }],
    heldBy: (name) => held[name.toLowerCase()] ?? 0,
    blockades: [{ country: "Borduria", pressure: 0.6 }],
    ...extra,
  });
  const after = turn([{ country: "Aland", value: 12 }, { country: "Neutralia", value: 9 }]);
  const month = (WEARINESS_A_YEAR * 30) / 365;
  // Aland called up 1% net and took two regions (a tenth of what it held).
  near(wearinessOf(after, "Aland"), Math.round((12 + month + WEARINESS_PER_SHARE_CALLED * 0.01 - WEARINESS_GROUND_TAKEN * 0.1) * 10) / 10, "Aland");
  // Borduria sent more men home than it called, lost a fifth of its ground and is blockaded.
  near(wearinessOf(after, "borduria"), Math.round((month + WEARINESS_ALL_GROUND_LOST * 0.2 + (WEARINESS_BLOCKADE_A_YEAR * 0.6 * 30) / 365) * 10) / 10, "Borduria");
  // Cisland's people are not known: nothing is charged for its men, only the month.
  near(wearinessOf(after, "Cisland"), Math.round(month * 10) / 10, "Cisland");
  // Neutralia is at peace, and its old weariness is going.
  near(wearinessOf(after, "Neutralia"), Math.round((9 - (WEARINESS_PEACE_A_YEAR * 30) / 365) * 10) / 10, "Neutralia");
  assert.deepEqual(after.map((entry) => entry.country), ["Aland", "Neutralia", "Borduria", "Cisland"]);
  // The same turn from the same world is the same figures.
  assert.deepEqual(turn([{ country: "Aland", value: 12 }, { country: "Neutralia", value: 9 }]), after);
  // The war over: everybody's falls away, and a country at nothing is kept no longer.
  const peace = turn(after, { wars: [{ ...WAR, status: "ended" }], days: 365 });
  assert.ok(wearinessOf(peace, "Borduria") < wearinessOf(after, "Borduria"));
  assert.equal(peace.some((entry) => entry.country === "Cisland"), false);
  // A ceasefire is not a war being fought.
  assert.deepEqual([...countriesAtWar([{ ...WAR, status: "ceasefire" }]).keys()], []);
  assert.deepEqual([...countriesAtWar([WAR]).values()], ["Aland", "Borduria", "Cisland"]);
  assert.deepEqual(withTurnWeariness(undefined, {}), []);
});

test("a country that goes to war with no weariness in the game goes as weary as its own figures say", () => {
  const own = { aland: 40, borduria: 70, cisland: 0, neutralia: 60 };
  const startOf = (name) => own[name.toLowerCase()] ?? null;
  // Aland has a figure in the game already, and it stands; Borduria goes in at its own 70; Cisland's own is
  // no weariness at all; Neutralia is at peace.
  const going = wearinessGoingIn([{ country: "Aland", value: 12 }], { wars: [WAR], startOf });
  assert.deepEqual(going, [{ country: "Aland", value: 12 }, { country: "Borduria", value: 70 }]);
  // Nobody's figures (or the scenario has them off): what the game holds, as it holds it.
  assert.deepEqual(wearinessGoingIn([{ country: "Aland", value: 12 }], { wars: [WAR] }), [{ country: "Aland", value: 12 }]);
  assert.deepEqual(wearinessGoingIn(undefined, { wars: [WAR], startOf: () => "x" }), []);
  // The period is counted from there.
  near(wearinessOf(withTurnWeariness(going, { days: 30, wars: [WAR] }), "Borduria"), Math.round((70 + (WEARINESS_A_YEAR * 30) / 365) * 10) / 10);
});

test("what the world keeps is a country once, a figure from 0 to 100, and nothing at nothing", () => {
  assert.deepEqual(normalizeWarWeariness([{ country: "Aland", value: 33.333 }, { country: "aland", value: 40 }, { country: "", value: 9 }, { country: "B", value: 0 }, { country: "C", value: 400 }, null, "x"]), [
    { country: "aland", value: 40 },
    { country: "C", value: 100 },
  ]);
  assert.deepEqual(normalizeWarWeariness(undefined), []);
  assert.equal(wearinessOf([{ country: "Aland", value: 40 }], "ALAND"), 40);
  assert.equal(wearinessOf([{ country: "Aland", value: 40 }], "Borduria"), 0);
  assert.equal(wearinessOf(null, ""), 0);
});

test("past a half it tells on a country's armies, and stands beside a blockade without being lost in it", () => {
  assert.equal(wearyShortage(0), 0);
  assert.equal(wearyShortage(WEARY_FROM), 0);
  near(wearyShortage(75), WEARY_SHORTAGE_MOST / 2);
  assert.equal(wearyShortage(100), WEARY_SHORTAGE_MOST);
  assert.equal(wearyShortage(900), WEARY_SHORTAGE_MOST);
  // Two shortages together are more than either and never more than everything.
  assert.equal(shortagesTogether(0, 0), 0);
  assert.equal(shortagesTogether(0.4, 0), 0.4);
  assert.equal(shortagesTogether(0, 0.25), 0.25);
  near(shortagesTogether(0.4, 0.5), 0.7);
  assert.equal(shortagesTogether(1, 0.5), 1);
  assert.equal(shortagesTogether(7, -2), 1);
  // And it has a word, for whoever reads the game.
  assert.deepEqual([0, 19, 20, 45, 60, 85].map(wearinessWord), ["", "", "uneasy", "strained", "war-weary", "exhausted"]);
});
