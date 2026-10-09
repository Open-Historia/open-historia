import assert from "node:assert/strict";
import test from "node:test";

import {
  POLITICAL_WORLD_CAPABILITY,
  politicalWorldCapability,
  politicalWorldCapabilityLabel,
} from "./politicalWorldCapability.js";

test("a scenario with no Political Actors has no Political World yet", () => {
  const result = politicalWorldCapability({ politicalActors: { byPolity: {} } }, { polityCount: 4 });
  assert.equal(result.status, POLITICAL_WORLD_CAPABILITY.ABSENT);
  assert.equal(result.available, false);
  assert.equal(result.actorCount, 0);
  assert.equal(politicalWorldCapabilityLabel(result), "Not generated");
});

test("some Political Actors mean the Political World exists but is partially developed", () => {
  const result = politicalWorldCapability({
    politicalActors: { byPolity: { Alpha: { polityKey: "Alpha" }, Beta: { polityKey: "Beta" } } },
  }, { polityCount: 4 });
  assert.equal(result.status, POLITICAL_WORLD_CAPABILITY.SPARSE);
  assert.equal(result.available, true);
  assert.equal(result.actorCount, 2);
  assert.equal(politicalWorldCapabilityLabel(result), "Available - partially developed");
});

test("coverage at or above the known polity count is presented as available", () => {
  const result = politicalWorldCapability({
    politicalActors: { byPolity: { Alpha: {}, Beta: {}, Gamma: {} } },
  }, { polityCount: 3 });
  assert.equal(result.status, POLITICAL_WORLD_CAPABILITY.AVAILABLE);
  assert.equal(result.available, true);
  assert.equal(politicalWorldCapabilityLabel(result), "Available");
});

test("an existing Political World stays available when no reliable polity count is supplied", () => {
  const result = politicalWorldCapability({ politicalActors: { byPolity: { Alpha: {} } } });
  assert.equal(result.status, POLITICAL_WORLD_CAPABILITY.AVAILABLE);
  assert.equal(result.polityCount, 0);
});
