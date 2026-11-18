/*! Open Historia — keeping countries' stat sheets up to date after time skips: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/statsRefresh.test.js
//
// "readd the background ai for refreshing the stats where you could set how
// often it runs" (the owner, 2026-11-18), with Off as one of the picker's
// choices and no switch of its own. Pinned: the schedule, the bound (one
// request a run, a handful of countries, at most one run every N skips), the
// shared-game rule, and that a time skip is still one request.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  STATS_REFRESH_BATCH_MOST,
  STATS_REFRESH_DEFAULT_EVERY,
  STATS_REFRESH_EVERY_CHOICES,
  STATS_REFRESH_KEYS,
  compactStatSheet,
  describeStatsRefreshEvidence,
  lastStatsRefreshRound,
  normalizeStatsRefreshEvery,
  pickStatsRefreshCountries,
  readStatsRefreshEvery,
  readStatsRefreshUpdates,
  rememberStatsRefreshRound,
  statsRefreshPatch,
  statsRefreshRequest,
  statsRefreshRunDue,
  writeStatsRefreshEvery,
} from "./statsRefresh.js";
import { SKIP_SPENDERS, createMemoryStorage } from "./requestBudget.js";

const source = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").split("\r\n").join("\n");
const withoutComments = (text) => text.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");

test("the picker: Off first and by default, then after every skip, every 2, 3, 5 or 10; anything else reads as Off", () => {
  assert.deepEqual([...STATS_REFRESH_EVERY_CHOICES], [0, 1, 2, 3, 5, 10]);
  assert.equal(STATS_REFRESH_DEFAULT_EVERY, 0, "requests are the scarce resource: nothing is spent until the player picks a pace");
  const storage = createMemoryStorage();
  assert.equal(readStatsRefreshEvery(storage), 0);
  assert.equal(readStatsRefreshEvery(null), 0, "no storage: Off");
  writeStatsRefreshEvery(storage, 3);
  assert.equal(readStatsRefreshEvery(storage), 3);
  assert.equal(storage.getItem(STATS_REFRESH_KEYS.every), "3");
  for (const odd of [4, -1, "x", 7.5, null, 100]) assert.equal(normalizeStatsRefreshEvery(odd), 0, String(odd));
});

test("the schedule: never while Off, once a record is missing, then only every N skips; a stepped-back future does not hold it", () => {
  assert.equal(statsRefreshRunDue({ every: 0, round: 9, lastRound: null }), false, "Off never runs");
  assert.equal(statsRefreshRunDue({ every: 5, round: 0, lastRound: null }), false, "no skip yet");
  assert.equal(statsRefreshRunDue({ every: 5, round: 1, lastRound: null }), true, "nothing asked yet in this campaign");
  assert.equal(statsRefreshRunDue({ every: 5, round: 9, lastRound: 5 }), false);
  assert.equal(statsRefreshRunDue({ every: 5, round: 10, lastRound: 5 }), true);
  assert.equal(statsRefreshRunDue({ every: 1, round: 6, lastRound: 5 }), true);
  assert.equal(statsRefreshRunDue({ every: 1, round: 5, lastRound: 5 }), false, "a skip written twice asks once");
  assert.equal(statsRefreshRunDue({ every: 3, round: 4, lastRound: 12 }), true, "the record is from rounds the player undid");
});

test("the bound: at most one request every N skips, counted per campaign as the request is made", () => {
  const storage = createMemoryStorage();
  assert.equal(lastStatsRefreshRound(storage, "game-a"), null);
  let requests = 0;
  for (let round = 1; round <= 20; round += 1) {
    if (!statsRefreshRunDue({ every: 5, round, lastRound: lastStatsRefreshRound(storage, "game-a") })) continue;
    rememberStatsRefreshRound(storage, "game-a", round);
    requests += 1;
  }
  assert.equal(requests, 4, "rounds 1, 6, 11 and 16");
  assert.equal(lastStatsRefreshRound(storage, "game-a"), 16);
  assert.equal(lastStatsRefreshRound(storage, "game-b"), null, "each campaign its own");
  for (let index = 0; index < 60; index += 1) rememberStatsRefreshRound(storage, `game-${index}`, index);
  const kept = Object.keys(JSON.parse(storage.getItem(STATS_REFRESH_KEYS.lastRun)));
  assert.ok(kept.length <= 40, "the record stays small");
  assert.ok(kept.includes("game-59"), "the newest are kept");
});

test("one run asks of a handful of stale sheets: the players' own first, then their enemies, then the longest unrefreshed", () => {
  const candidates = [
    { name: "Austria", assessedRound: 2, fresh: 3 },
    { name: "Prussia", assessedRound: 8, fresh: 1 },
    { name: "France", assessedRound: 9, fresh: 2 },
    { name: "Spain", assessedRound: 1, fresh: 0 },
    { name: "Russia", assessedRound: 9, fresh: 4 },
    { name: "Sweden", assessedRound: 4, fresh: 1 },
    { name: "Denmark", assessedRound: 3, fresh: 1 },
    { name: "Portugal", assessedRound: 5, fresh: 1 },
    { name: "Naples", assessedRound: 6, fresh: 1 },
    { name: "Venice", assessedRound: 7, fresh: 1 },
  ];
  const names = pickStatsRefreshCountries({ candidates, players: ["France"], opponents: ["prussia"], round: 10, every: 1 });
  assert.equal(names.length, STATS_REFRESH_BATCH_MOST);
  assert.deepEqual(names, ["France", "Prussia", "Austria", "Denmark", "Sweden", "Portugal"]);
  assert.ok(!names.includes("Spain"), "nothing changed under it: refreshing it would only cost");
  const slow = pickStatsRefreshCountries({ candidates, players: ["France"], round: 10, every: 5 });
  assert.ok(!slow.includes("France") && !slow.includes("Russia"), "assessed within the last five skips");
  assert.deepEqual(pickStatsRefreshCountries({ candidates: [{ name: "Austria", assessedRound: 2, fresh: 0 }], round: 10 }), []);
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
  assert.ok(refresh.indexOf("rememberStatsRefreshRound(") < refresh.indexOf("callAIWithTaskLimit("), "counted before it is asked");
  assert.match(refresh, /firstReading\("stats refresh"/, "deduplicated, silent, and stopped by the background allowance like every first reading");
  assert.match(refresh, /backgroundAiAllowance\(\)\.allowed/);
});

test("a shared game: only the host's engine, and only while its own AI answers for everyone; never a guest's page", () => {
  const gameplay = withoutComments(source("./gameplay.js"));
  const refresh = gameplay.slice(gameplay.indexOf("export const refreshStaleStatSheets"), gameplay.indexOf("export const assessPoliticalLandscape"));
  assert.match(refresh, /if \(!every \|\| inSharedGame\(\) \|\| !hostReadsFigures\(\)\) return Promise\.resolve\(null\);/);
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
