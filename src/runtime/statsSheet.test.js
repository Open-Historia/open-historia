// loadStatSheetDefinition reads a scenario's stats.json once per library
// generation, never serves one generation's sheet for another, and never keeps
// a failed read. Driven through the real library state with a stubbed fetch.
import test from "node:test";
import assert from "node:assert/strict";

import { refreshLibraryCatalog } from "./library.js";
import { loadStatIndexDefinition, loadStatSheetDefinition, resetStatSheetCache } from "./statsSheet.js";

const CUSTOM_SHEET = {
  sections: [{ key: "realm", label: "Realm", stats: [{ key: "piety", label: "Piety", kind: "index" }] }],
};

// A library whose runtime scenario is `scenario`, and a stats.json answer.
const installFetch = ({ scenario, token, stats }) => {
  const calls = { stats: 0 };
  let answer = stats;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.startsWith("/api/library")) {
      return new Response(JSON.stringify({
        games: [{ id: "g1", scenarioId: scenario.id, cacheToken: "g1-1" }],
        activeGameId: "g1",
        scenarios: [scenario],
        runtimeScenario: { id: scenario.id },
        token,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path.includes(`/api/scenarios/${scenario.id}/assets/stats`)) {
      calls.stats += 1;
      const current = typeof answer === "function" ? answer() : answer;
      return current === null
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify(current), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, setAnswer: (value) => { answer = value; } };
};

const scenario = (over = {}) => ({ id: "sc1", name: "Old Kingdoms", cacheToken: "sc1-1", updatedAt: "1", assetStatus: { stats: true }, ...over });

test("a scenario's stats sheet is read once per library generation", async () => {
  resetStatSheetCache();
  const { calls } = installFetch({ scenario: scenario(), token: "t1", stats: CUSTOM_SHEET });
  await refreshLibraryCatalog({ force: true });

  const first = await loadStatSheetDefinition();
  const second = await loadStatSheetDefinition();
  assert.equal(first.custom, true);
  assert.equal(calls.stats, 1);
  // Each call gets its own copy.
  first.sections[0].label = "changed";
  assert.equal((await loadStatSheetDefinition()).sections[0].label, "Realm");
  assert.equal(second.sections[0].label, "Realm");

  // force re-reads.
  await loadStatSheetDefinition({ force: true });
  assert.equal(calls.stats, 2);
});

test("a new library token reads the sheet again", async () => {
  resetStatSheetCache();
  installFetch({ scenario: scenario(), token: "t1", stats: CUSTOM_SHEET });
  await refreshLibraryCatalog({ force: true });
  assert.equal((await loadStatSheetDefinition()).custom, true);

  // The scenario was saved without its custom sheet: the library moves on.
  const next = installFetch({ scenario: scenario({ updatedAt: "2", cacheToken: "sc1-2", assetStatus: { stats: false } }), token: "t2", stats: {} });
  await refreshLibraryCatalog({ force: true });
  assert.equal((await loadStatSheetDefinition()).custom, false);
  assert.equal(next.calls.stats, 1, "the new generation read its own sheet");
});

test("a read from the previous generation that lands late is not served for the new one", async () => {
  resetStatSheetCache();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  installFetch({ scenario: scenario(), token: "t6", stats: CUSTOM_SHEET });
  await refreshLibraryCatalog({ force: true });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/assets/stats")) await held;
    return realFetch(url);
  };
  const stale = loadStatSheetDefinition();

  installFetch({ scenario: scenario({ updatedAt: "3", cacheToken: "sc1-3", assetStatus: {} }), token: "t7", stats: {} });
  await refreshLibraryCatalog({ force: true });
  const fresh = await loadStatSheetDefinition();
  release();
  assert.equal((await stale).custom, true);
  assert.equal(fresh.custom, false);
  assert.equal((await loadStatSheetDefinition()).custom, false);
});

test("a failed read throws and is not kept, so the next call tries again", async () => {
  resetStatSheetCache();
  const { calls, setAnswer } = installFetch({ scenario: scenario(), token: "t3", stats: null });
  await refreshLibraryCatalog({ force: true });

  await assert.rejects(loadStatSheetDefinition(), /Could not load the Stats definition for scenario "Old Kingdoms"/);
  setAnswer(CUSTOM_SHEET);
  assert.equal((await loadStatSheetDefinition()).custom, true);
  assert.equal(calls.stats, 2);
});

test("a scenario without a stats.json gets the standard sheet, and keeps it", async () => {
  resetStatSheetCache();
  const { calls } = installFetch({ scenario: scenario({ assetStatus: {} }), token: "t4", stats: null });
  await refreshLibraryCatalog({ force: true });
  assert.equal((await loadStatSheetDefinition()).custom, false);
  assert.equal((await loadStatSheetDefinition()).custom, false);
  assert.equal(calls.stats, 1);
});

test("loadStatIndexDefinition uses a definition it is handed instead of reading", async () => {
  resetStatSheetCache();
  const { calls } = installFetch({ scenario: scenario(), token: "t5", stats: CUSTOM_SHEET });
  await refreshLibraryCatalog({ force: true });
  const definition = await loadStatSheetDefinition();
  const indices = await loadStatIndexDefinition({ definition });
  assert.equal(indices.custom, true);
  assert.deepEqual(indices.rows.map((row) => row.key), ["piety"]);
  assert.equal(calls.stats, 1);
});
