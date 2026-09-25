import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePoliticalActorRecord,
  normalizePoliticalActors,
  normalizePoliticalResponseProfile,
  POLITICAL_ACTORS_SCHEMA_VERSION,
} from "./politicalActors.js";
import { buildPublicPoliticalView } from "./politicalKnowledge.js";

test("Political Actors v5 owns bounded hidden response profiles for parties and power blocs", () => {
  const actor = normalizePoliticalActorRecord({
    polityKey: "Testland",
    government: { form: "Parliamentary republic" },
    parties: [{
      id: "reform",
      name: "Reform Party",
      support: { percent: 25 },
      responseProfile: {
        organization: 140,
        credibility: -12,
        inertia: 72.36,
        resilience: 51,
        issues: {
          immigration: { stance: 130, sensitivity: 84, strainAffinity: -120 },
          "bad issue !": { position: 50 },
        },
      },
    }],
    powerBlocs: [{
      id: "army",
      name: "Army",
      influence: { percent: 30 },
      politicalResponse: {
        issues: { security: { position: 90, sensitivity: 75 } },
      },
    }],
  });

  assert.equal(POLITICAL_ACTORS_SCHEMA_VERSION, 6);
  assert.equal(actor.parties[0].politicalResponse.organization, 100);
  assert.equal(actor.parties[0].politicalResponse.credibility, 0);
  assert.equal(actor.parties[0].politicalResponse.inertia, 72.4);
  assert.equal(actor.parties[0].politicalResponse.issues.immigration.position, 100);
  assert.equal(actor.parties[0].politicalResponse.issues.immigration.strainResponse, -100);
  assert.equal("bad issue !" in actor.parties[0].politicalResponse.issues, false);
  assert.equal("responseProfile" in actor.parties[0], false);
  assert.equal(actor.powerBlocs[0].politicalResponse.issues.security.position, 90);
});

test("legacy actors upgrade to schema v5 without inventing response profiles", () => {
  const normalized = normalizePoliticalActors({
    schemaVersion: 4,
    byPolity: {
      Legacy: {
        polityKey: "Legacy",
        government: { form: "Parliamentary republic" },
        parties: [{ id: "a", name: "A", support: { percent: 50 } }],
      },
    },
  });

  assert.equal(normalized.schemaVersion, 6);
  assert.equal("politicalResponse" in normalized.byPolity.Legacy.parties[0], false);
});

test("response profile normalizer drops empty junk rather than creating simulation behavior", () => {
  assert.equal(normalizePoliticalResponseProfile({ nonsense: true }), null);
  assert.equal(normalizePoliticalResponseProfile(null), null);
});

test("normal Country political knowledge does not expose hidden response mechanics", () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Testland: {
          polityKey: "Testland",
          government: { form: "Parliamentary republic" },
          parties: [{
            id: "a",
            name: "A",
            support: { percent: 50 },
            politicalResponse: {
              organization: 90,
              issues: { immigration: { position: 100, sensitivity: 100 } },
            },
          }],
          powerBlocs: [{
            id: "court",
            name: "Court",
            influence: { percent: 30 },
            politicalResponse: {
              issues: { reform: { position: -80, sensitivity: 80 } },
            },
          }],
        },
      },
    }),
  };

  const view = buildPublicPoliticalView(world, "Testland");
  assert.ok(view);
  assert.equal("politicalResponse" in view.parties[0], false);
  assert.equal("politicalResponse" in view.powerBlocs[0], false);
});
