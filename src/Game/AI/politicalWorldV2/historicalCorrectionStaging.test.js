import assert from "node:assert/strict";
import test from "node:test";

import { applyValidatedHistoricalCorrectionToStagedActor } from "./historicalCorrectionStaging.js";

const currentActor = {
  polityKey: "Republic A",
  politicalSystem: {
    type: "parliamentary_republic",
    representation: "electoral",
    label: "Parliamentary republic",
  },
  government: {
    form: "Parliamentary republic",
    headOfState: "President Old",
    headOfGovernment: "Prime Minister Old",
    rulingPartyIds: ["gov"],
    coalitionPartyIds: ["ally"],
    ideology: "Centrist",
  },
  parties: [
    { id: "gov", name: "Government Party", ideology: "Centrist", support: { percent: 45, basis: "generated-estimate" } },
    { id: "ally", name: "Alliance Party", ideology: "Liberal", support: { percent: 20, basis: "generated-estimate" } },
    { id: "opp", name: "Opposition Party", ideology: "Conservative", support: { percent: 30, basis: "generated-estimate" } },
  ],
  traits: { pragmatism: 60, caution: 50 },
  goals: ["Preserve stability"],
  fears: ["Regional isolation"],
  ambitions: ["Increase influence"],
  domesticPressures: ["Budget constraints"],
  perceptions: { Neighbor: { threat: 30 } },
};

const correctionEntry = (correctionPatch, appliedPaths, extra = {}) => ({
  item: { polityKey: "Republic A" },
  validation: { appliedPaths: [...appliedPaths] },
  historicalVerification: {
    verdict: "corrected",
    correctionPatch,
    replaceRepresentationEntities: false,
    ...extra,
  },
});

test("historical correction updates its generated-owned field without erasing unrelated staged Political Actor state", () => {
  const corrected = applyValidatedHistoricalCorrectionToStagedActor({
    currentActor,
    correctionEntry: correctionEntry(
      { government: { headOfGovernment: "Prime Minister Correct" } },
      ["government.headOfGovernment"],
    ),
  });

  assert.equal(corrected.government.headOfGovernment, "Prime Minister Correct");
  assert.equal(corrected.government.headOfState, "President Old");
  assert.deepEqual(corrected.government.rulingPartyIds, ["gov"]);
  assert.deepEqual(corrected.parties.map((party) => party.id), ["gov", "ally", "opp"]);
  assert.deepEqual(corrected.traits, currentActor.traits);
  assert.deepEqual(corrected.goals, currentActor.goals);
  assert.deepEqual(corrected.domesticPressures, currentActor.domesticPressures);
});

test("historical correction cannot overwrite a field that validation did not mark as generator-owned", () => {
  const corrected = applyValidatedHistoricalCorrectionToStagedActor({
    currentActor,
    correctionEntry: correctionEntry(
      { government: { headOfState: "Invented Replacement" } },
      ["government.headOfGovernment"],
    ),
  });

  assert.equal(corrected.government.headOfState, "President Old");
});

test("validated representation replacement drops superseded generated entities without discarding surviving entity state", () => {
  const corrected = applyValidatedHistoricalCorrectionToStagedActor({
    currentActor,
    correctionEntry: correctionEntry(
      {
        government: { rulingPartyIds: ["gov"], coalitionPartyIds: [] },
        parties: [{ id: "gov", name: "Government Party Corrected" }],
      },
      ["government.rulingPartyIds", "government.coalitionPartyIds", "parties"],
      { replaceRepresentationEntities: true },
    ),
  });

  assert.deepEqual(corrected.parties.map((party) => party.id), ["gov"]);
  assert.equal(corrected.parties[0].name, "Government Party Corrected");
  assert.deepEqual(corrected.parties[0].support, { percent: 45, basis: "generated-estimate" });
  assert.deepEqual(corrected.government.rulingPartyIds, ["gov"]);
  assert.deepEqual(corrected.government.coalitionPartyIds, []);
});
