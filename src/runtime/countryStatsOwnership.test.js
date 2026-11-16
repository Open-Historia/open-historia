import test from "node:test";
import assert from "node:assert/strict";
import {
  standardStatsMutationError,
  standardStatsPreviousSummary,
  standardGameMasterPatchForApply,
} from "./countryStatsOwnership.js";

test("Brazil GM inflation regression: rejects standard inflation stored as customStats", () => {
  const wrong = { countryStatPatches: [{
    country: "Brazil",
    patch: { customStats: { inflation: 7 } },
    eventIndexes: [],
  }] };
  assert.match(standardStatsMutationError("gameMaster", wrong),
    /countryStatPatches\[0\]\.patch\.customStats.*inflation.*economy/i);
  assert.deepEqual(wrong.countryStatPatches[0].patch, { customStats: { inflation: 7 } },
    "validation must not move or silently reinterpret a GM transaction");
  assert.equal(standardStatsMutationError("gameMaster", { countryStatPatches: [{
    country: "Brazil", patch: { economy: { inflation: 7 } },
  }] }), "");
});

test("GM standard/custom ownership: only legacy live intelligence alias survives standard GM validation", () => {
  const intelligence = { countryStatPatches: [{ patch: { customStats: { intelligenceService: 67 } } }] };
  assert.equal(standardStatsMutationError("gameMaster", intelligence), "");
  for (const value of [-1, 101, 40.5, "45", null]) {
    assert.match(standardStatsMutationError("gameMaster", { countryStatPatches: [{
      patch: { customStats: { intelligenceService: value } },
    }] }), /intelligenceService/);
  }
  assert.match(standardStatsMutationError("gameMaster", { countryStatPatches: [{
    patch: { customStats: { intelligenceService: 40, inflation: 7 } },
  }] }), /inflation/);
  assert.match(standardStatsMutationError("gameMaster", { countryStatPatches: [{
    patch: { customStats: {} },
  }] }), /customStats/);
  assert.match(standardStatsMutationError("gameMaster", { events: [{
    impacts: { polityChanges: [{ stats: { customStats: { inflation: 7 } } }] },
  }] }), /events\[0\].*customStats.*inflation/);
  assert.match(standardStatsMutationError("jumpForward", { events: [{
    impacts: { polityChanges: [{ stats: { customStats: { inflation: 7 } } }] },
  }] }), /customStats.*inflation/);
});

test("standard GM Apply routes intelligence alias exclusively to native capability owner", () => {
  const standard = { economy: { inflation: 7 }, customStats: { intelligenceService: 65 }, stability: 45 };
  assert.deepEqual(standardGameMasterPatchForApply(standard), {
    economy: { inflation: 7 }, stability: 45,
  });
  assert.deepEqual(standard.customStats, { intelligenceService: 65 });
  assert.deepEqual(standardGameMasterPatchForApply({ customStats: { intelligenceService: 65 } }), {});
  assert.throws(() => standardGameMasterPatchForApply({ customStats: { inflation: 7 } }), /inflation/);
  assert.deepEqual(standardGameMasterPatchForApply({ economy: { inflation: 7 } }), { economy: { inflation: 7 } });
});

test("standard Stats previous context omits invalid sidecar without changing persisted save or its economy", () => {
  const legacy = {
    capital: "Brasilia", economy: { inflation: 8.5, gdp: 1935000000000 },
    customStats: { inflation: 7 }, territorialComponents: [{ id: "BR-1", population: 200 }],
    continuity: { stateFingerprint: "keep" }, indices: { foodAutonomy: 80 },
  };
  const previous = structuredClone(legacy);
  const summary = standardStatsPreviousSummary(legacy);
  assert.deepEqual(summary.economy, previous.economy);
  assert.deepEqual(summary.continuity, previous.continuity);
  assert.equal("customStats" in summary, false);
  assert.equal("territorialComponents" in summary, false);
  assert.deepEqual(legacy, previous, "normalizing prompt context must not mutate or repair a live save");
});
