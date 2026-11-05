import test from "node:test";
import assert from "node:assert/strict";

import { describeWorldLedgersForAdvisor, polityEntry } from "./advisorLedgers.js";

const SHEET = (gdp, food) => ({
  stability: 70,
  indices: { foodAutonomy: food, energyAutonomy: 50, economicIndependence: 60 },
  economy: { gdp, gdpGrowth: 3, inflation: 2, unemployment: 5, publicDebt: 40, budgetBalance: -1 },
});

const world = {
  polityOverrides: {
    "Republic of China": { code: "Republic of China", name: "Republic of China" },
    "Soviet Union": { code: "Soviet Union", name: "Soviet Union" },
    "United States": { code: "United States", name: "United States" },
    "Mongolia": { code: "Mongolia", name: "Mongolia" },
  },
  regionOwnershipOverrides: { r1: "Republic of China", r2: "Soviet Union", r3: "United States", r4: "Mongolia" },
  wars: [{ id: "border-war", status: "active", sideA: ["Republic of China"], sideB: ["Soviet Union"], startedDate: "1961-03-01" }],
  relations: [{ a: "Republic of China", b: "United States", score: 72, status: "friendly" }],
  agreements: [],
  // The truth of a covert arrangement the player has not uncovered.
  puppets: [{ overlord: "Soviet Union", puppet: "Mongolia", kind: "puppet", secrecy: "covert", status: "active", loyalty: 80 }],
  countryStats: {
    "Republic of China": SHEET(433e9, 47),
    "Soviet Union": SHEET(1.2e12, 88),
    "United States": SHEET(2.9e12, 90),
  },
};

test("the advisor reads the war ledger, the relations and the other powers' figures", () => {
  const text = describeWorldLedgersForAdvisor(world, [{ countries: [{ name: "United States" }] }], "Republic of China");
  assert.match(text, /border-war \| ACTIVE \| SIDE A: Republic of China \| SIDE B: Soviet Union/);
  assert.match(text, /United States/);
  assert.match(text, /Soviet Union: GDP-eq €1.2T/);
  assert.match(text, /United States: GDP-eq €2.9T/);
  // The player's own sheet is described elsewhere, in full.
  assert.doesNotMatch(text, /Republic of China: GDP-eq/);
  // One list of powers, not a paragraph of simulator guidance per power.
  assert.doesNotMatch(text, /Economic stress constrains/);
});

test("a covert subordination the player never uncovered stays out", () => {
  const text = describeWorldLedgersForAdvisor(world, [{ countries: [{ name: "Mongolia" }] }], "Republic of China");
  assert.doesNotMatch(text, /SUBORDINATIONS|covert|COVERT/);
  assert.doesNotMatch(text, /Soviet Union directs|directs Mongolia/);
});

test("no wars says so plainly, without the simulator's authorisation rule", () => {
  const text = describeWorldLedgersForAdvisor({ ...world, wars: [] }, [], "Republic of China");
  assert.match(text, /No war or ceasefire is recorded\./);
  assert.doesNotMatch(text, /authorized to fight/);
});

test("ledger entries are found whatever the case of the name", () => {
  assert.equal(polityEntry({ "Soviet Union": 1 }, "soviet union"), 1);
  assert.equal(polityEntry({ "Soviet Union": 1 }, "Poland"), undefined);
  assert.equal(polityEntry(null, "Soviet Union"), undefined);
});
