import assert from "node:assert/strict";
import test from "node:test";

import { resolveScenarioInstitutionReferenceCatalog } from "./institutionReferenceCatalogs.js";
import { materializeScenarioCanon } from "../../runtime/scenarioCanon.js";

test("legacy and fictional scenarios receive no Earth institution history unless current canon explicitly opts in", () => {
  assert.deepEqual(resolveScenarioInstitutionReferenceCatalog({}, { scenarioDate: "2014-03-22" }), []);
  const fictional = materializeScenarioCanon({}, {
    canonContext: {
      universe: { id: "wasteland", type: "fictional" },
      referencePacks: [],
      referenceAuthority: "none",
    },
  });
  assert.deepEqual(resolveScenarioInstitutionReferenceCatalog(fictional, { scenarioDate: "2287-01-01" }), []);
});

test("historical Earth reference data is loaded only by current scenario opt-in and exact authority horizon", () => {
  const world = materializeScenarioCanon({}, {
    canonContext: {
      universe: { id: "historical-earth", type: "historical" },
      referencePacks: [{ id: "earth-history", version: "1.0", enabled: true }],
      referenceAuthority: "round-zero-only",
    },
  });
  const catalog = resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate: "2014-03-22" });
  assert.ok(catalog.length > 8);
  const successor = catalog.find((entry) => Array.isArray(entry.predecessors) && entry.predecessors.some((predecessor) => predecessor.membershipContinuity));
  assert.ok(successor, "Earth pack should contain data-driven predecessor continuity");
});
