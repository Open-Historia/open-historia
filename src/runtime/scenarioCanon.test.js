import assert from "node:assert/strict";
import test from "node:test";

import {
  CANON_MODEL_VERSION,
  enabledReferencePackIds,
  materializeScenarioCanon,
  normalizeCanonContext,
  readScenarioCanon,
  scenarioCanonMode,
  summarizeScenarioCanon,
  updateScenarioCanonContext,
} from "./scenarioCanon.js";

test("legacy world reads through compatibility view without materializing canon fields", () => {
  const world = {
    startingTimelineText: "Legacy scenario",
    politicalActors: { byPolity: { Alpha: { id: "alpha" } } },
  };
  const before = JSON.stringify(world);
  const view = readScenarioCanon(world);

  assert.equal(view.mode, "legacy");
  assert.equal(view.initialized, false);
  assert.equal(view.canonContext.source, "legacy-uninitialized");
  assert.equal(world.canonModelVersion, undefined);
  assert.equal(world.canonContext, undefined);
  assert.equal(JSON.stringify(world), before);
});

test("explicit canon-context edit upgrades a legacy world to current v2", () => {
  const legacy = { startingTimelineText: "Keep me" };
  const next = updateScenarioCanonContext(legacy, {
    universe: { id: "historical-earth", type: "historical" },
    referencePacks: [{ id: "earth-history", version: "1.0", enabled: true }],
    referenceAuthority: "round-zero-only",
  });

  assert.equal(legacy.canonModelVersion, undefined);
  assert.equal(next.canonModelVersion, CANON_MODEL_VERSION);
  assert.equal(next.startingTimelineText, "Keep me");
  assert.deepEqual(enabledReferencePackIds(next.canonContext), ["earth-history"]);
  assert.equal(scenarioCanonMode(next), "current");
});

test("materialization preserves existing ledgers unless explicitly replaced", () => {
  const world = {
    agreements: [{ id: "old-agreement" }],
    politicalActors: { byPolity: { Alpha: { id: "alpha" } } },
  };
  const next = materializeScenarioCanon(world, {
    canonContext: { universe: { id: "custom", type: "fictional" } },
  });

  assert.deepEqual(next.agreements, world.agreements);
  assert.deepEqual(next.politicalActors, world.politicalActors);
  assert.equal(next.institutions, undefined);
});

test("canon context normalization is generic and preserves only enabled unique packs", () => {
  const context = normalizeCanonContext({
    universe: { id: "fallout", type: "fictional" },
    referencePacks: [
      { id: "wasteland-pack", enabled: true },
      { id: "wasteland-pack", enabled: false },
      { id: "optional-pack", enabled: false },
    ],
    referenceAuthority: "none",
  });

  assert.equal(context.universe.id, "fallout");
  assert.equal(context.universe.type, "fictional");
  assert.deepEqual(enabledReferencePackIds(context), ["wasteland-pack"]);
});

test("current canon summary reports owning-ledger counts without inventing legacy initialization", () => {
  const world = materializeScenarioCanon({
    politicalActors: { byPolity: { Alpha: {}, Beta: {} } },
    institutions: {
      schemaVersion: 1,
      ledgerVersion: 0,
      byId: {
        council: { id: "council", name: "Council", foundedDate: "2000-01-01", members: [] },
      },
    },
    agreements: [{ id: "a" }],
    powerStatus: { byPolity: { Alpha: {} } },
  }, {
    canonContext: { universe: { id: "custom", type: "custom" } },
  });

  const summary = summarizeScenarioCanon(world);
  assert.equal(summary.mode, "current");
  assert.equal(summary.politicalActors, 2);
  assert.equal(summary.institutions, 1);
  assert.equal(summary.agreements, 1);
  assert.equal(summary.powerStatus, 1);
});

test("selected reference packs are inactive when reference authority is none", async () => {
  const { activeReferencePackIds } = await import("./scenarioCanon.js");
  const context = normalizeCanonContext({
    universe: { id: "historical-earth", type: "historical" },
    referencePacks: [{ id: "earth-history", version: "1.0", enabled: true }],
    referenceAuthority: "none",
  });

  assert.deepEqual(enabledReferencePackIds(context), ["earth-history"]);
  assert.deepEqual(activeReferencePackIds(context), []);
});


test("legacy divergence-description text is preserved for compatibility even though runtime authority uses only the cutoff date", () => {
  const context = normalizeCanonContext({
    universe: { id: "historical-earth", type: "alternate" },
    referenceAuthority: "pre-divergence-only",
    divergence: {
      date: "1970-01-01",
      description: "1970-01-01: Event X happens.\r\n1970-01-02: Event Y follows.  \n1970-01-03: Event Z changes the political situation.",
    },
  });

  assert.equal(context.divergence.date, "1970-01-01");
  assert.equal(
    context.divergence.description,
    "1970-01-01: Event X happens.\n1970-01-02: Event Y follows.\n1970-01-03: Event Z changes the political situation.",
  );
});

