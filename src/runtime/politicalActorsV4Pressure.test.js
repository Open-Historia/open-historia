import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePoliticalActorRecord,
  normalizePoliticalActors,
  POLITICAL_ACTORS_SCHEMA_VERSION,
} from "./politicalActors.js";

test("Political Actors v5 preserves and bounds the background political pressure ledger", () => {
  const actor = normalizePoliticalActorRecord({
    polityKey: "Testland",
    government: { form: "Parliamentary republic" },
    parties: [{ id: "a", name: "A", support: { percent: 50 } }],
    politicalPressures: {
      updatedAt: "2020-01-01",
      issues: {
        immigration: { salience: 140, lean: 72, strain: 18, persistence: 0.9 },
      },
    },
  });

  assert.equal(POLITICAL_ACTORS_SCHEMA_VERSION, 6);
  assert.equal(actor.politicalPressures.issues.immigration.salience, 100);
  assert.equal(actor.politicalPressures.issues.immigration.lean, 72);
  assert.equal(actor.politicalPressures.updatedAt, "2020-01-01");
});

test("normalizing legacy actors without pressures does not invent background politics", () => {
  const normalized = normalizePoliticalActors({
    schemaVersion: 3,
    byPolity: {
      Monarchy: {
        polityKey: "Monarchy",
        government: { form: "Absolute monarchy" },
        parties: [],
        powerBlocs: [{ id: "court", name: "Royal Court", influence: { label: "Dominant" } }],
      },
    },
  });

  assert.equal(normalized.schemaVersion, 6);
  assert.equal("politicalPressures" in normalized.byPolity.Monarchy, false);
});
