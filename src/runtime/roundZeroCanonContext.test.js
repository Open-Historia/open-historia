import test from "node:test";
import assert from "node:assert/strict";

import { materializeScenarioCanon } from "./scenarioCanon.js";
import {
  buildRoundZeroCanonContext,
  buildRoundZeroCanonContextText,
} from "./roundZeroCanonContext.js";

const alternateWorld = materializeScenarioCanon({
  startingTimelineText: "The designed start world reflects decades of divergence.",
  simulationRules: "Do not resurrect institutions that this scenario dissolved.",
}, {
  canonContext: {
    universe: { id: "custom-reference-universe", type: "alternate" },
    referencePacks: [{ id: "custom-reference-pack", enabled: true }],
    referenceAuthority: "pre-divergence-only",
    divergence: { date: "1963-11-22" },
  },
});

test("shared Round-Zero context separates target date from exclusive reference cutoff", () => {
  const context = buildRoundZeroCanonContext({
    scenario: { name: "Alternate World" },
    game: { startDate: "2014-03-22" },
    world: alternateWorld,
  });
  assert.equal(context.scenarioDate, "2014-03-22");
  assert.equal(context.historyAuthority.cutoffDate, "1963-11-22");
  assert.equal(context.historyAuthority.cutoffInclusive, false);
  assert.equal(context.historyAuthority.referenceHorizonDate, "1963-11-21");
  assert.equal(context.divergence.date, "1963-11-22");
  assert.equal(context.worldBeforeRoundOneMode, "authoritative");
});

test("prompt projection makes authored canon outrank post-cutoff reference history", () => {
  const text = buildRoundZeroCanonContextText({
    scenario: { name: "Alternate World", description: "A custom branch." },
    game: { startDate: "2014-03-22" },
    world: alternateWorld,
  });
  assert.match(text, /TARGET START-WORLD DATE: 2014-03-22/);
  assert.match(text, /only BEFORE 1963-11-22/);
  assert.match(text, /Reference canon stops being authoritative at 1963-11-22/);
  assert.match(text, /authority cutoff, not a second history ledger/i);
  assert.match(text, /AUTHORITATIVE WORLD BEFORE ROUND ONE/);
  assert.match(text, /never invent post-cutoff source history to fill gaps/i);
  assert.match(text, /constraints, not historical facts/i);
  assert.doesNotMatch(text, /Kennedy|NATO|Russia|Earth/i);
});

test("fictional/custom scenarios with no external authority remain fully scenario-owned", () => {
  const world = materializeScenarioCanon({ startingTimelineText: "The city-states emerged from the Ashfall." }, {
    canonContext: {
      universe: { id: "ashfall", type: "fictional" },
      referenceAuthority: "none",
    },
  });
  const text = buildRoundZeroCanonContextText({ game: { startDate: "800-01-01" }, world });
  assert.match(text, /External\/reference canon has NO authority/i);
  assert.match(text, /Ashfall/);
  assert.doesNotMatch(text, /HISTORY MODE|derive-missing|authored-only/);
});

test("World Before Round One remains authoritative scenario canon after divergence", () => {
  const world = materializeScenarioCanon({
    startingTimelineText: "1973: The authored world changes permanently. Later source-canon history no longer applies.",
  }, {
    canonContext: {
      universe: { id: "branching-reference", type: "alternate" },
      referenceAuthority: "pre-divergence-only",
      divergence: { date: "1973" },
    },
  });
  const context = buildRoundZeroCanonContext({ game: { startDate: "2287" }, world });
  assert.equal(context.worldBeforeRoundOneMode, "authoritative");
  const text = buildRoundZeroCanonContextText({ game: { startDate: "2287" }, world });
  assert.match(text, /AUTHORITATIVE WORLD BEFORE ROUND ONE/);
  assert.match(text, /External\/reference canon after the divergence has no authority/i);
});
