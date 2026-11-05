import assert from "node:assert/strict";
import test from "node:test";

import { createPoliticalWorldV2Checkpoint } from "./checkpoint.js";
import { reopenPoliticalWorldV2OfficeholderCollisions } from "./officeholderCollisions.js";

const checkpointWith = (governments, verified) => {
  const checkpoint = createPoliticalWorldV2Checkpoint({
    scenarioId: "s",
    scenarioDate: "2014-03-22",
    stagedWorld: { politicalActors: { schemaVersion: 1, byPolity: Object.fromEntries(Object.entries(governments).map(([polity, government]) => [polity, { polityKey: polity, government }])) } },
  });
  checkpoint.historicalVerificationRequired = true;
  for (const polity of Object.keys(governments)) checkpoint.generationEntriesByPolity[polity] = { item: { polityKey: polity } };
  checkpoint.coverage["historical-verification"] = [...verified];
  return checkpoint;
};

test("a head of government shared by two verified polities re-opens both as challenges, once", () => {
  const checkpoint = checkpointWith({
    A: { headOfGovernment: "Prime Minister Jane Doe" },
    B: { headOfGovernment: "Jane Doe" },
    C: { headOfGovernment: "John Roe" },
  }, ["A", "B", "C"]);
  reopenPoliticalWorldV2OfficeholderCollisions(checkpoint);
  assert.deepEqual(checkpoint.coverage["historical-verification"], ["C"]);
  assert.match(checkpoint.verification.challenges.A.issue, /MANDATORY SAME-DATE OFFICEHOLDER COLLISION on 2014-03-22/);
  assert.equal(checkpoint.verification.challenges.B.temporalCorrectionEstablished, false);
  assert.equal(checkpoint.verification.officeholderCollisionRechecks.length, 1);

  // Re-checked and confirmed: kept with a warning, never re-opened again.
  checkpoint.coverage["historical-verification"] = ["A", "B", "C"];
  delete checkpoint.verification.challenges.A;
  delete checkpoint.verification.challenges.B;
  reopenPoliticalWorldV2OfficeholderCollisions(checkpoint);
  assert.deepEqual(checkpoint.coverage["historical-verification"], ["A", "B", "C"]);
  assert.deepEqual(checkpoint.verification.challenges, {});
  assert.ok(checkpoint.warnings.some((warning) => /Officeholder collision kept/.test(warning)));
});

test("a collision waits until every polity in it has been verified, and a shared monarch is no collision", () => {
  const waiting = checkpointWith({ A: { headOfGovernment: "Jane Doe" }, B: { headOfGovernment: "Jane Doe" } }, ["A"]);
  reopenPoliticalWorldV2OfficeholderCollisions(waiting);
  assert.deepEqual(waiting.coverage["historical-verification"], ["A"]);
  assert.deepEqual(waiting.verification.challenges, {});

  const realms = checkpointWith({ A: { headOfState: "King Charles III" }, B: { headOfState: "Charles III" } }, ["A", "B"]);
  reopenPoliticalWorldV2OfficeholderCollisions(realms);
  assert.deepEqual(realms.coverage["historical-verification"], ["A", "B"]);
});

test("worlds without exact-date verification are left alone", () => {
  const checkpoint = checkpointWith({ A: { headOfGovernment: "Jane Doe" }, B: { headOfGovernment: "Jane Doe" } }, ["A", "B"]);
  checkpoint.historicalVerificationRequired = false;
  reopenPoliticalWorldV2OfficeholderCollisions(checkpoint);
  assert.deepEqual(checkpoint.coverage["historical-verification"], ["A", "B"]);
});
