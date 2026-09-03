import test from "node:test";
import assert from "node:assert/strict";

import { applyEventImpactsToWorld } from "../src/runtime/gameState.js";

test("presentation preview structurally shares non-impact campaign ledgers", () => {
  const world = {
    polityOverrides: {},
    countryStats: {},
    countryTags: {},
    internationalReputation: {},
    regionOwnershipOverrides: { r1: "A" },
    regionSovereigntyOverrides: {},
    regionClaimants: {},
    agreements: [],
    units: [],
    markers: [],
    cityRenames: {},
    simulationHistory: [{ round: 1 }],
    consolidatedHistory: [{ summary: "canon" }],
    storylines: [{ id: "s1" }],
  };

  const event = {
    id: "e1",
    date: "2020-01-01",
    title: "marker build",
    impacts: {
      polityChanges: [],
      regionTransfers: [],
      regionControlOps: [],
      unitOps: [],
      markerOps: [{
        op: "build",
        markerId: "m1",
        name: "Test Site",
        kind: "facility",
        lng: 24,
        lat: 57,
        status: "active",
      }],
    },
  };

  const result = applyEventImpactsToWorld({
    world,
    events: [event],
    presentationPreview: true,
    logUnitCombat: false,
  });

  assert.equal(result.world.simulationHistory, world.simulationHistory);
  assert.equal(result.world.consolidatedHistory, world.consolidatedHistory);
  assert.equal(result.world.storylines, world.storylines);
  assert.notEqual(result.world.markers, world.markers);
  assert.deepEqual(world.markers, []);
});

test("presentation preview does not mutate canonical ownership object", () => {
  const world = {
    polityOverrides: {},
    countryStats: {},
    countryTags: {},
    internationalReputation: {},
    regionOwnershipOverrides: { r1: "A" },
    regionSovereigntyOverrides: {},
    regionClaimants: {},
    agreements: [],
    units: [],
    markers: [],
    cityRenames: {},
  };

  const event = {
    id: "e2",
    date: "2020-01-02",
    title: "control shift",
    impacts: {
      polityChanges: [],
      regionTransfers: [],
      regionControlOps: [{
        op: "control",
        regionId: "r1",
        fromCode: "A",
        toCode: "B",
      }],
      unitOps: [],
      markerOps: [],
    },
  };

  applyEventImpactsToWorld({
    world,
    events: [event],
    presentationPreview: true,
    logUnitCombat: false,
  });

  assert.equal(world.regionOwnershipOverrides.r1, "A");
});
