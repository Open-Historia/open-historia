/*! Open Historia — keeping countries' stat sheets up to date after time skips: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/statsRefresh.test.js
//
// "readd the background ai for refreshing the stats where you could set how
// often it runs"; "NO SETTING FOR IT, JUST IN THE ADVANCED STATS MENU YOU CAN
// CHOOSE WHAT INTERVAL IT CHECKS AT AND YOU CAN SET THE INTERVAL TO OFF. BY
// DEFAULT ITS 6 MONTHS" (the owner, 2026-11-18). Pinned: the schedule in game
// months, the default, Off, the bound (one request a run, a handful of
// countries, at most one run a skip), the shared-game rule, and that a time
// skip is still one request.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  STATS_REFRESH_BATCH_MOST,
  STATS_REFRESH_DEFAULT_MONTHS,
  STATS_REFRESH_KEYS,
  STATS_REFRESH_MONTH_CHOICES,
  compactStatSheet,
  describeStatsRefreshEvidence,
  lastStatsRefreshDate,
  normalizeStatsRefreshMonths,
  pickStatsRefreshCountries,
  readStatsRefreshMonths,
  readStatsRefreshUpdates,
  rememberStatsRefreshDate,
  statsRefreshPatch,
  statsRefreshRequest,
  statsRefreshRunDue,
  writeStatsRefreshMonths,
} from "./statsRefresh.js";
import { SKIP_SPENDERS, createMemoryStorage } from "./requestBudget.js";

const source = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").split("\r\n").join("\n");
const withoutComments = (text) => text.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");

test("the interval: Off, 3, 6, 12 or 24 game months, 6 by default; anything else reads as 6", () => {
  assert.deepEqual([...STATS_REFRESH_MONTH_CHOICES], [0, 3, 6, 12, 24]);
  assert.equal(STATS_REFRESH_DEFAULT_MONTHS, 6);
  const storage = createMemoryStorage();
  assert.equal(readStatsRefreshMonths(storage), 6, "on by default");
  assert.equal(readStatsRefreshMonths(null), 6, "no storage: the default");
  writeStatsRefreshMonths(storage, 0);
  assert.equal(readStatsRefreshMonths(storage), 0, "Off is kept");
  writeStatsRefreshMonths(storage, 12);
  assert.equal(storage.getItem(STATS_REFRESH_KEYS.months), "12");
  for (const odd of [4, -1, "x", 7.5, null, 100]) assert.equal(normalizeStatsRefreshMonths(odd), 6, String(odd));
});

test("the schedule in game time: never while Off; once the interval has passed since the last run, or since the campaign began", () => {
  const start = "1805-01-01";
  assert.equal(statsRefreshRunDue({ months: 0, date: "1830-01-01", lastDate: null, startDate: start }), false, "Off never runs");
  assert.equal(statsRefreshRunDue({ months: 6, date: "1805-05-01", lastDate: null, startDate: start }), false, "four months in");
  assert.equal(statsRefreshRunDue({ months: 6, date: "1805-07-01", lastDate: null, startDate: start }), true, "six months in");
  assert.equal(statsRefreshRunDue({ months: 6, date: "1806-03-01", lastDate: "1805-10-01", startDate: start }), false);
  assert.equal(statsRefreshRunDue({ months: 6, date: "1806-04-01", lastDate: "1805-10-01", startDate: start }), true);
  assert.equal(statsRefreshRunDue({ months: 12, date: "1805-03-01", lastDate: "1808-01-01", startDate: start }), true, "the record is from a future the player undid");
  assert.equal(statsRefreshRunDue({ months: 6, date: "", lastDate: null, startDate: start }), false, "no date, no run");
});

test("the bound: at most one request a skip, however long, and none until the interval has passed again", () => {
  const storage = createMemoryStorage();
  assert.equal(lastStatsRefreshDate(storage, "game-a"), null);
  const skips = ["1805-02-01", "1805-04-01", "1805-08-01", "1815-08-01", "1815-09-01", "1816-01-01", "1816-03-01"];
  const asked = [];
  for (const date of skips) {
    if (!statsRefreshRunDue({ months: 6, date, lastDate: lastStatsRefreshDate(storage, "game-a"), startDate: "1805-01-01" })) continue;
    rememberStatsRefreshDate(storage, "game-a", date);
    asked.push(date);
  }
  assert.deepEqual(asked, ["1805-08-01", "1815-08-01", "1816-03-01"], "a ten-year skip is one request, not twenty");
  assert.equal(lastStatsRefreshDate(storage, "game-b"), null, "each campaign its own");
  for (let index = 0; index < 60; index += 1) rememberStatsRefreshDate(storage, `game-${index}`, "1805-01-01");
  const kept = Object.keys(JSON.parse(storage.getItem(STATS_REFRESH_KEYS.lastRun)));
  assert.ok(kept.length <= 40, "the record stays small");
  assert.ok(kept.includes("game-59"), "the newest are kept");
});

test("one run asks of a handful of stale sheets: the players' own first, then their enemies, then the longest unrefreshed", () => {
  const candidates = [
    { name: "Austria", assessedDate: "1801-01-01", fresh: 3 },
    { name: "Prussia", assessedDate: "1805-06-01", fresh: 1 },
    { name: "France", assessedDate: "1805-07-01", fresh: 2 },
    { name: "Spain", assessedDate: "1800-01-01", fresh: 0 },
    { name: "Russia", assessedDate: "1806-11-01", fresh: 4 },
    { name: "Sweden", assessedDate: "1803-01-01", fresh: 1 },
    { name: "Denmark", assessedDate: "1802-01-01", fresh: 1 },
    { name: "Portugal", assessedDate: "1804-01-01", fresh: 1 },
    { name: "Naples", assessedDate: "1804-06-01", fresh: 1 },
    { name: "Venice", assessedDate: "", fresh: 1 },
  ];
  const names = pickStatsRefreshCountries({ candidates, players: ["France"], opponents: ["prussia"], date: "1807-01-01", months: 6 });
  assert.equal(names.length, STATS_REFRESH_BATCH_MOST);
  assert.deepEqual(names, ["France", "Prussia", "Venice", "Austria", "Denmark", "Sweden"]);
  assert.ok(!names.includes("Spain"), "nothing changed under it: refreshing it would only cost");
  assert.ok(!names.includes("Russia"), "assessed two months ago");
  assert.deepEqual(pickStatsRefreshCountries({ candidates: [{ name: "Austria", assessedDate: "1801-01-01", fresh: 0 }], date: "1807-01-01" }), []);
});

test("the request names every country as it is given and never sends an event's id; the answer is read by those names only", () => {
  const evidence = describeStatsRefreshEvidence([
    { id: "evt-8f2c", date: "1806-10-14", title: "Battle of Jena", description: "Prussia's army is broken." },
  ]);
  assert.match(evidence, /1806-10-14: Battle of Jena: Prussia's army is broken\./);
  assert.doesNotMatch(evidence, /evt-8f2c/);
  const { systemPrompt, userMessage, asked } = statsRefreshRequest({
    date: "1806-11-01",
    indices: "- militaryStrength", indexKeys: ["militaryStrength"],
    countries: [
      { name: "Kingdom of Prussia", since: "1806-01-01", values: compactStatSheet({ stability: 60, indices: { militaryStrength: 70 }, economy: { gdp: 5 } }, [{ key: "militaryStrength" }]), evidence },
      { name: "French Empire", since: "1806-01-01", values: {}, evidence: "" },
    ],
  });
  assert.deepEqual(asked, ["Kingdom of Prussia", "French Empire"]);
  assert.match(userMessage, /=== Kingdom of Prussia ===/);
  assert.match(userMessage, /"militaryStrength":70/);
  assert.doesNotMatch(userMessage, /evt-8f2c/);
  assert.match(systemPrompt, /exactly as it is given/);
  const read = readStatsRefreshUpdates({ updates: [
    { country: "kingdom of  prussia", stability: 40 },
    { country: "Prussia", stability: 10 },
    { country: "Kingdom of Prussia", stability: 99 },
    { country: "Atlantis", stability: 1 },
  ] }, asked);
  assert.deepEqual(read.map((entry) => [entry.name, entry.update.stability]), [["Kingdom of Prussia", 40]], "the same name only, once; never a near one");
});

test("an update is a bounded patch of the figures a refresh may move, and nothing of the map ledger", () => {
  const rows = [{ key: "militaryStrength" }];
  assert.deepEqual(statsRefreshPatch({
    stability: 140,
    indices: { militaryStrength: 55, invented: 3 },
    population: { total: 1234.6 },
    economy: { gdp: 9, gdpPerCapita: 2, inflation: "4", unemployment: null },
    gdpBreakdown: { agriculture: 30, industry: 30 },
    territorialComponents: [{ geography: "Silesia" }],
  }, rows), {
    stability: 100,
    indices: { militaryStrength: 55 },
    population: { total: 1235 },
    economy: { gdp: 9, inflation: 4 },
  });
  assert.equal(statsRefreshPatch({ country: "Prussia" }, rows), null);
});

// gameplay.js does not load in node: how the refresh is asked and written is pinned from the source.
test("a time skip is still one request: the refresh is a background request of its own after the skip is written", () => {
  assert.deepEqual([...SKIP_SPENDERS], ["jump", "institutionBallots"], "nothing new may spend inside a skip");
  const gameplay = withoutComments(source("./gameplay.js"));
  const after = gameplay.slice(gameplay.indexOf("const afterJumpWritten = async"), gameplay.indexOf("const storeKeptTurn"));
  assert.match(after, /reportJumpRequests\(requests\);\n\s*void refreshStaleStatSheets\(\)/, "after the skip's requests are counted, and never awaited");
  const refresh = gameplay.slice(gameplay.indexOf("export const refreshStaleStatSheets"), gameplay.indexOf("export const assessPoliticalLandscape"));
  assert.ok(refresh.length > 0);
  assert.equal((refresh.match(/callAIWithTaskLimit\(/g) || []).length, 1, "one request a run");
  assert.match(refresh, /requestKind: BACKGROUND_REQUEST/, "counted as background work, under the day's cap");
  assert.doesNotMatch(refresh, /budget|spender|jumpTaskOptions|requests\./, "never the skip's budget");
  assert.ok(refresh.indexOf("await waitForSimulationIdle()") < refresh.indexOf("callAIWithTaskLimit("), "never while the world is busy");
  assert.ok(refresh.indexOf("rememberStatsRefreshDate(") < refresh.indexOf("callAIWithTaskLimit("), "counted before it is asked");
  assert.match(refresh, /firstReading\("stats refresh"/, "deduplicated, silent, and stopped by the background allowance like every first reading");
  assert.match(refresh, /backgroundAiAllowance\(\)\.allowed/);
});

test("a shared game: only the host's engine, and only while its own AI answers for everyone; never a guest's page", () => {
  const gameplay = withoutComments(source("./gameplay.js"));
  const refresh = gameplay.slice(gameplay.indexOf("export const refreshStaleStatSheets"), gameplay.indexOf("export const assessPoliticalLandscape"));
  assert.match(refresh, /if \(!months \|\| inSharedGame\(\) \|\| !hostReadsFigures\(\)\) return Promise\.resolve\(null\);/);
  assert.match(refresh, /beginStatsWrite\(campaign, null, \{ inOrder: "stats-refresh" \}\)/, "the write is one entry of the host's order");
});

test("it writes through the stat sheet's own write, the one the Stats pane's Refresh uses, held to the same continuity guard", () => {
  const gameplay = withoutComments(source("./gameplay.js"));
  const refresh = gameplay.slice(gameplay.indexOf("export const refreshStaleStatSheets"), gameplay.indexOf("export const assessPoliticalLandscape"));
  assert.match(refresh, /await persistStatSheet\(\{/);
  assert.match(refresh, /guardCountryStatContinuity\(previous, merged/);
  assert.doesNotMatch(refresh, /mutateWorldState|persistCountryStatsBackground/, "no writer of its own");
  const generate = gameplay.slice(gameplay.indexOf("export const generateCountryStatSheet"), gameplay.indexOf("export const refinePlayerAction"));
  assert.match(generate, /return await persistStatSheet\(\{/, "the standard sheet's Refresh");
  const custom = gameplay.slice(gameplay.indexOf("const generateScenarioCustomStatSheet"), gameplay.indexOf("export const generateCountryStatSheet"));
  assert.match(custom, /return await persistStatSheet\(\{/, "a scenario's own sheet's Refresh");
  assert.match(custom, /customStatEvidenceOf\(/, "and the same test of what changed");
});

test("no keyword matching: who a development concerns is read from its structure, never its words", () => {
  const module = withoutComments(source("./statsRefresh.js"));
  assert.doesNotMatch(module, /includes\(\s*["'`][a-z]/i);
  const gameplay = withoutComments(source("./gameplay.js"));
  const refresh = gameplay.slice(gameplay.indexOf("export const refreshStaleStatSheets"), gameplay.indexOf("export const assessPoliticalLandscape"));
  assert.doesNotMatch(refresh, /statsTextMentionsTarget|RegExp|\.test\(/);
});

test("the interval is in Advanced Statistics only: nothing in Settings, and a guest is not shown it", () => {
  const settings = source("../GameUI/settings.jsx");
  assert.doesNotMatch(settings, /statsRefresh/, "no setting for it");
  const stats = source("../GameUI/stats.jsx");
  const modal = stats.slice(stats.indexOf("const AdvancedStatsModal = ("), stats.indexOf("const STOCK_COUNTRY_NAMES"));
  assert.match(modal, /<StatsRefreshCadence \/>/);
  const card = stats.slice(stats.indexOf("const StatsRefreshCadence = ("), stats.indexOf("const AdvancedStatsModal = ("));
  assert.match(card, /STATS_REFRESH_MONTH_CHOICES\.map/);
  assert.match(card, /if \(role === "guest"\) return null;/);
});
