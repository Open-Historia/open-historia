/*! Open Historia — what a prompt is told of a country's standing: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/standingContext.test.js
//
// standingContext.js is the one place the prompts read a country's standing
// from: the skip and the suggestion tasks through gameplay.js, the advisor and
// the leaders through main.jsx. What has to hold is in each test's name.
import test from "node:test";
import assert from "node:assert/strict";

import {
  STAT_HISTORY_ROWS,
  describeIntelligenceStanding,
  describeLeaderStanding,
  describeOurFigures,
  describeReputationStanding,
  describeStatHistory,
  describeStatSheet,
  otherRecordedReputations,
  recordedReputation,
  reputationOf,
} from "./standingContext.js";

const PLAYER = "French Republic";

const WORLD = {
  internationalReputation: { [PLAYER]: 72, "Kingdom of Italy": 18, Spain: 50, Portugal: 61, "German Empire": 90 },
  intelligence: { [PLAYER]: 64, "German Empire": 80 },
};

// ---- Reputation --------------------------------------------------------------

test("a reputation is the one the AI evolved, else the Stats sheet's, else a neutral 50", () => {
  assert.equal(recordedReputation(WORLD, PLAYER), 72);
  assert.equal(recordedReputation({ countryStats: { Spain: { indices: { internationalReputation: 33.4 } } } }, "Spain"), 33);
  assert.equal(recordedReputation(WORLD, "Belgium"), null);
  assert.equal(reputationOf(WORLD, "Belgium"), 50);
  assert.equal(reputationOf(WORLD, "Belgium", 41), 41, "the caller's own fallback");
  assert.equal(recordedReputation(WORLD, "french republic"), null, "a polity name is an exact key");
});

test("the player's reputation comes with every other recorded one, the most extreme first", () => {
  const text = describeReputationStanding(WORLD, PLAYER);
  assert.equal(text.split("\n")[0], "International reputation: 72/100 (well-regarded).");
  assert.match(text, /^Other recorded reputations: German Empire 90\/100, Kingdom of Italy 18\/100, Portugal 61\/100\. Every polity not listed stands at 50\.$/m);
  assert.doesNotMatch(text.split("\n")[1], /Spain|French Republic/, "a neutral 50 and the player are not listed");
  assert.deepEqual(otherRecordedReputations(WORLD, [PLAYER], 1), [["German Empire", 90]]);
  assert.equal(describeReputationStanding({}, PLAYER), "International reputation: 50/100 (mixed).", "nothing else recorded, nothing else said");
  assert.equal(describeReputationStanding(WORLD, ""), "No player polity is currently set.");
});

test("the intelligence line names the player's service and the others the AI has rated", () => {
  assert.equal(describeIntelligenceStanding(WORLD, PLAYER), "French Republic's intelligence service: 64/100 (capable).\nOther rated services: German Empire 80/100.");
  assert.match(describeIntelligenceStanding({}, "Belgium"), /^Belgium's intelligence service: \d+\/100 \(ordinary\)\.$/);
  assert.equal(describeIntelligenceStanding(WORLD, ""), "");
});

// ---- The Stats sheet ---------------------------------------------------------

const SHEET = {
  stability: 68,
  population: { total: 41000000 },
  government: "Third Republic",
  leader: "Raymond Poincaré",
  economy: { gdp: 1.2e11, gdpPerCapita: 2900, gdpGrowth: 1.8, inflation: 2.4, unemployment: 5.1, publicDebt: 84, budgetBalance: -2.1, currency: "franc" },
  indices: { sovereignty: 88, internalSecurity: 71, internationalReputation: 70, foodAutonomy: 80, energyAutonomy: 55, economicIndependence: 66 },
};
const FIGURES_WORLD = {
  ...WORLD,
  countryStats: { [PLAYER]: SHEET, "German Empire": { ...SHEET, stability: 41, leader: "Wilhelm II" } },
  countryStatsHistory: {
    [PLAYER]: [
      { date: "1914-06-01", gdp: 1.15e11, gdpGrowth: 1.5, stability: 69 },
      { date: "1914-01-01", gdp: 1.1e11, gdpGrowth: 1.2, stability: 70 },
      ...Array.from({ length: 8 }, (_unused, index) => ({ date: `1913-0${index + 1}-01`, gdp: 1e11, stability: 71 })),
    ],
  },
};

test("a sheet is one line of the figures the Stats panel shows", () => {
  const line = describeStatSheet(SHEET, PLAYER);
  for (const figure of ["population 41M", "stability 68/100", "sovereignty 88/100", "internal security 71/100", "leader Raymond Poincaré", "GDP-eq €120B", "growth 1.8%", "inflation 2.4%", "unemployment 5.1%", "debt 84% GDP", "budget -2.1% GDP"]) {
    assert.ok(line.includes(figure), figure);
  }
  assert.ok(line.startsWith(`${PLAYER}: `));
  assert.equal(describeStatSheet(null, PLAYER), "");
  assert.equal(describeStatSheet({}, PLAYER), "", "an empty sheet says nothing");
  assert.match(describeStatSheet({ customStats: { grainReserves: 12 } }), /grainReserves 12/, "a scenario's own stats");
});

test("the history gives the last few samples as dated points, oldest first", () => {
  const rows = describeStatHistory(FIGURES_WORLD, PLAYER);
  assert.equal(rows.length, STAT_HISTORY_ROWS);
  assert.equal(rows.at(-1), "- 1 June 1914: GDP-eq €115B; growth 1.5%; stability 69/100");
  assert.equal(rows.at(-2), "- 1 January 1914: GDP-eq €110B; growth 1.2%; stability 70/100");
  assert.deepEqual(describeStatHistory(FIGURES_WORLD, "Belgium"), []);
});

test("the advisor is given its own country's figures, their history, its reputation and its service", () => {
  const text = describeOurFigures(FIGURES_WORLD, PLAYER);
  assert.match(text, /^\[Our Country's Figures\]\n/);
  assert.match(text, /never contradict them/);
  assert.ok(text.includes(describeStatSheet(SHEET, PLAYER)));
  assert.match(text, /- 1 June 1914: GDP-eq €115B/);
  assert.ok(text.includes(describeReputationStanding(FIGURES_WORLD, PLAYER)));
  assert.ok(text.includes(describeIntelligenceStanding(FIGURES_WORLD, PLAYER)));
  assert.doesNotMatch(text, /Wilhelm II/, "another country's sheet is not ours");

  const bare = describeOurFigures(WORLD, PLAYER);
  assert.match(bare, /No Stats sheet has been drawn up for French Republic yet\. Estimate figures from the record, and say they are estimates\./);
  assert.match(bare, /International reputation: 72\/100/);
  assert.equal(describeOurFigures(WORLD, ""), "");
});

test("a leader is told the player's reputation, its own, and only its own figures", () => {
  const text = describeLeaderStanding(FIGURES_WORLD, { player: PLAYER, speakers: ["German Empire"] });
  assert.match(text, /^\[Standing\]\nFrench Republic: international reputation 72\/100 \(well-regarded\)\.\nGerman Empire: international reputation 90\/100 \(well-regarded\)\./);
  assert.match(text, /Your government's own figures: German Empire: .*leader Wilhelm II/);
  assert.doesNotMatch(text, /Poincaré/, "the player's figures are not the leader's to know");
  assert.match(describeLeaderStanding(WORLD, { player: PLAYER, speakers: ["Belgium"] }), /Belgium: international reputation 50\/100 \(mixed\)\./);
  assert.equal(describeLeaderStanding(WORLD, { player: PLAYER, speakers: [] }), "");
});

test("several leaders in one request each get their reputation, and nobody's figures", () => {
  const text = describeLeaderStanding(FIGURES_WORLD, { player: PLAYER, speakers: ["German Empire", "Kingdom of Italy", "German Empire"] });
  assert.match(text, /German Empire: international reputation 90\/100/);
  assert.match(text, /Kingdom of Italy: international reputation 18\/100 \(poor\)/);
  assert.equal(text.match(/German Empire:/g).length, 1);
  assert.doesNotMatch(text, /own figures/);
});

test("the advisor's guidance uses the sheet where it has a figure, and estimates only the rest", async () => {
  const { default: prompts } = await import("./defaultPrompts.json", { with: { type: "json" } });
  const statistics = prompts.advisor.slice(prompts.advisor.indexOf("you may mention statistics"));
  assert.match(statistics, /^you may mention statistics\. Where \[Our Country's Figures\] gives a figure, use it as it stands and never contradict it/);
  assert.match(statistics, /For anything it does not give, use historical records/);
});
