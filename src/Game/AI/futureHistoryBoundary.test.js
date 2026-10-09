import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRealHistoryDirective,
  resolveReferenceKnowledgeBoundary,
} from "./futureHistoryBoundary.js";

const currentWorld = ({ authority = "round-zero-only", divergence = null, type = null } = {}) => ({
  canonModelVersion: 2,
  canonContext: {
    universe: { id: "historical-earth", type: type || (divergence ? "alternate" : "historical") },
    referencePacks: [{ id: "earth-history", version: "1.0", enabled: true }],
    referenceAuthority: authority,
    divergence,
  },
});

// The rule this replaced told the model that nothing it remembered after the
// game's start was evidence, so a skip through May 2014 could not hold that
// month's real elections, coups or crises. Real history is the default now.
test("a game set in our history keeps following real history after its start", () => {
  const resolved = resolveReferenceKnowledgeBoundary({
    world: currentWorld(),
    game: { startDate: "2014-03-22", gameDate: "2014-04-21" },
  });
  assert.equal(resolved.authority, "round-zero-only");
  assert.equal(resolved.startDate, "2014-03-22");
  assert.equal(resolved.universeType, "historical");

  const text = buildRealHistoryDirective({
    world: currentWorld(),
    game: { startDate: "2014-03-22", gameDate: "2014-04-21" },
    originDate: "2014-04-21",
  });
  assert.match(text, /^\[This Game and Real History\]/);
  assert.match(text, /This game began on 2014-03-22, and this jump starts on 2014-04-21\./);
  assert.match(text, /stays the default for everything the game has not changed/);
  assert.match(text, /the real events of this period happen, with their real people, places, dates and numbers/);
});

test("none of the old boundary's prohibitions survive", () => {
  for (const world of [currentWorld(), {}, currentWorld({ authority: "none" })]) {
    const text = buildRealHistoryDirective({ world, game: { startDate: "2014-03-22" } });
    for (const gone of [/MEMORY IS NOT EVIDENCE/i, /COUNTERFACTUAL FUTURE/i, /BRANCH AUDIT/i, /admissible only/i]) {
      assert.doesNotMatch(text, gone);
    }
  }
});

test("an alternate history splits from ours on its own divergence, and says how", () => {
  const world = currentWorld({
    authority: "pre-divergence-only",
    divergence: { date: "1991-08-19", description: "August coup succeeds" },
  });
  const resolved = resolveReferenceKnowledgeBoundary({
    world,
    game: { startDate: "2014-03-22", gameDate: "2014-03-22" },
  });
  assert.equal(resolved.horizon, "1991-08-19");
  assert.equal(resolved.inclusive, false);
  assert.equal(resolved.referenceHorizonDate, "1991-08-18");
  assert.equal(resolved.divergenceDescription, "August coup succeeds");

  const text = buildRealHistoryDirective({ world, game: { startDate: "2014-03-22" } });
  assert.match(text, /split from ours on 1991-08-19/);
  assert.match(text, /simulate from the scenario's premises/);
  assert.match(text, /How it split: August coup succeeds/);
});

test("a fictional world follows its own lore", () => {
  const text = buildRealHistoryDirective({
    world: currentWorld({ authority: "none", type: "fictional" }),
    game: { startDate: "2200-01-01", gameDate: "2200-02-01" },
  });
  assert.match(text, /This world is not ours/);
  assert.match(text, /the setting's own lore/);
});

test("a custom world with no stated authority is read from its briefing", () => {
  const text = buildRealHistoryDirective({
    world: currentWorld({ authority: "none", type: "custom" }),
    game: { startDate: "1936-01-01" },
  });
  assert.match(text, /If the scenario's briefing places this world in our history/);
});

test("a scenario from before Scenario Canon is a game set in our history", () => {
  const resolved = resolveReferenceKnowledgeBoundary({
    world: {},
    game: { startDate: "1912-01-01", gameDate: "1914-08-01" },
  });
  assert.equal(resolved.authority, "legacy-campaign-start");
  assert.equal(resolved.canonInitialized, false);
  const text = buildRealHistoryDirective({
    world: {},
    game: { startDate: "1912-01-01", gameDate: "1914-08-01" },
  });
  assert.match(text, /This game began on 1912-01-01, and this jump starts on 1914-08-01\./);
  assert.match(text, /stays the default/);
});

test("reference authority dates use Beta's BC-capable game calendar", () => {
  const world = currentWorld({
    authority: "pre-divergence-only",
    divergence: { date: "-0218-03-01", description: "Rome chooses another course" },
  });
  const resolved = resolveReferenceKnowledgeBoundary({
    world,
    game: { startDate: "-0200-01-01", gameDate: "-0199-01-01" },
  });
  assert.equal(resolved.horizon, "-0218-03-01");
  assert.equal(resolved.referenceHorizonDate, "-0218-02-28");
});
