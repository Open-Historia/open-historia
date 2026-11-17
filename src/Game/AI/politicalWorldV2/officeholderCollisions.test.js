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

// An officeholder is { name, title }, and a collision is two polities' heads
// with the same name: a title is never read out of the words.
test("a head of government shared by two verified polities re-opens both as challenges, once", () => {
  const checkpoint = checkpointWith({
    A: { headOfGovernment: { name: "Jane Doe", title: "Prime Minister" } },
    B: { headOfGovernment: { name: "Jane Doe", title: "Premier" } },
    C: { headOfGovernment: { name: "John Roe", title: "Prime Minister" } },
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

test("the same name collides in any language; a title is never stripped out of an old one-text head", () => {
  const french = checkpointWith({
    A: { headOfGovernment: { name: "Jeanne Dupont", title: "Première ministre" } },
    B: { headOfGovernment: { name: "Jeanne Dupont", title: "Cheffe du gouvernement" } },
  }, ["A", "B"]);
  reopenPoliticalWorldV2OfficeholderCollisions(french);
  assert.deepEqual(french.coverage["historical-verification"], []);
  const chinese = checkpointWith({
    A: { headOfGovernment: { name: "王伟", title: "总理" } },
    B: { headOfGovernment: { name: "王伟", title: "首相" } },
  }, ["A", "B"]);
  reopenPoliticalWorldV2OfficeholderCollisions(chinese);
  assert.deepEqual(chinese.coverage["historical-verification"], []);
  // A head saved as one text is compared whole: "Prime Minister Jane Doe" is no
  // more cut to Jane Doe than "Première ministre Jeanne Dupont" to Jeanne Dupont.
  for (const [titled, bare] of [["Prime Minister Jane Doe", "Jane Doe"], ["Première ministre Jeanne Dupont", "Jeanne Dupont"]]) {
    const legacy = checkpointWith({ A: { headOfGovernment: titled }, B: { headOfGovernment: bare } }, ["A", "B"]);
    reopenPoliticalWorldV2OfficeholderCollisions(legacy);
    assert.deepEqual(legacy.coverage["historical-verification"], ["A", "B"], titled);
  }
});

test("worlds without exact-date verification are left alone", () => {
  const checkpoint = checkpointWith({ A: { headOfGovernment: "Jane Doe" }, B: { headOfGovernment: "Jane Doe" } }, ["A", "B"]);
  checkpoint.historicalVerificationRequired = false;
  reopenPoliticalWorldV2OfficeholderCollisions(checkpoint);
  assert.deepEqual(checkpoint.coverage["historical-verification"], ["A", "B"]);
});
