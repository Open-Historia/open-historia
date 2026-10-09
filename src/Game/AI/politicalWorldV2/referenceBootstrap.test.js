import assert from "node:assert/strict";
import test from "node:test";

import { materializeScenarioCanon } from "../../../runtime/scenarioCanon.js";
import { reconcilePoliticalWorldV2ReferenceState } from "./referenceBootstrap.js";

const historicalEarth = () => materializeScenarioCanon({
  polityOverrides: {
    "Republic of Latvia": { name: "Republic of Latvia" },
    "Federal Republic of Germany": { name: "Federal Republic of Germany" },
    "United States of America": { name: "United States of America" },
  },
}, {
  canonContext: {
    universe: { id: "historical-earth", type: "historical" },
    referencePacks: [{ id: "earth-history", version: "1.0", enabled: true }],
    referenceAuthority: "round-zero-only",
    divergence: null,
  },
});

test("2014 Historical Earth reference bootstrap materializes the full eligible reference institution scope", () => {
  const result = reconcilePoliticalWorldV2ReferenceState({
    world: historicalEarth(),
    scenarioDate: "2014-03-22",
    polities: ["Republic of Latvia", "Federal Republic of Germany", "United States of America"],
  });

  assert.deepEqual(result.activeReferencePackIds, ["earth-history"]);
  assert.equal(result.expectedReferenceInstitutionIds.length, 13);
  assert.equal(result.materializedReferenceInstitutionIds.length, 13);
  assert.equal(result.missingReferenceInstitutionIds.length, 0);
  assert.equal(result.referenceCoveredInstitutionIds.length, 13);
  assert.equal(Object.keys(result.world.institutions?.byId || {}).length, 13);
  assert.ok(result.world.institutions.byId.nato.members.some((entry) => entry.polity === "Republic of Latvia"));
});

test("legacy/custom worlds still receive no Earth reference institutions implicitly", () => {
  const result = reconcilePoliticalWorldV2ReferenceState({
    world: { polityOverrides: { Wasteland: { name: "Wasteland" } } },
    scenarioDate: "2287-01-01",
    polities: ["Wasteland"],
  });

  assert.deepEqual(result.activeReferencePackIds, []);
  assert.deepEqual(result.expectedReferenceInstitutionIds, []);
  assert.equal(Object.keys(result.world.institutions?.byId || {}).length, 0);
});
