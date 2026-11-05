import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePoliticalActorRecord,
  normalizePoliticalActors,
  normalizePoliticalBehavioralDisposition,
  POLITICAL_ACTORS_SCHEMA_VERSION,
} from "./politicalActors.js";

 test("Political Actors v6 owns bounded behavioral disposition while preserving legacy extension fields", () => {
  const actor = normalizePoliticalActorRecord({
    polityKey: "Testland",
    government: { form: "Republic" },
    behavioralDisposition: {
      assertiveness: 140,
      riskTolerance: -4,
      escalationAcceptance: 63,
      updatedAt: "2067-03-22",
    },
  });

  assert.equal(POLITICAL_ACTORS_SCHEMA_VERSION, 6);
  assert.equal(actor.behavioralDisposition.assertiveness, 100);
  assert.equal(actor.behavioralDisposition.riskTolerance, 0);
  assert.equal(actor.behavioralDisposition.escalationAcceptance, 63);
  assert.equal(actor.behavioralDisposition.updatedAt, "2067-03-22");
});

test("legacy Political Actors upgrade to v6 without inventing a disposition", () => {
  const normalized = normalizePoliticalActors({
    schemaVersion: 5,
    byPolity: {
      Legacy: {
        polityKey: "Legacy",
        government: { form: "Republic" },
        parties: [],
      },
    },
  });

  assert.equal(normalized.schemaVersion, 6);
  assert.equal("behavioralDisposition" in normalized.byPolity.Legacy, false);
});

test("disposition normalizer rejects empty junk but keeps compatible legacy metrics", () => {
  assert.equal(normalizePoliticalBehavioralDisposition(null), null);
  assert.equal(normalizePoliticalBehavioralDisposition({}), null);
  assert.deepEqual(normalizePoliticalBehavioralDisposition({ escalationAcceptance: 63 }), { escalationAcceptance: 63 });
});
