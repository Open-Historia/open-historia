import test from "node:test";
import assert from "node:assert/strict";

import {
  historicalChallengeStillAppliesToEntry,
  rebasePoliticalWorldVerificationEntry,
} from "./verificationEntry.js";

const baseEntry = (polityKey, actorPatch) => ({
  item: { polityKey, depth: "standard", needs: ["representation_entities"], hasExistingActor: true },
  proposal: { polityKey, depth: "standard", actorPatch },
  validation: { appliedPaths: [], provenance: { appliedPaths: [] }, actor: {} },
});

test("verification entry rebases stale generated government references to current staged canon", () => {
  const kyrgyz = rebasePoliticalWorldVerificationEntry(
    baseEntry("Kyrgyz Republic", {
      government: { coalitionPartyIds: ["respublika", "ata-meken"] },
      parties: [{ id: "sdpk" }, { id: "respublika" }, { id: "ata-meken" }, { id: "ar-namys" }],
    }),
    {
      polityKey: "Kyrgyz Republic",
      government: { coalitionPartyIds: ["ata-meken", "ar-namys"] },
      parties: [{ id: "sdpk" }, { id: "respublika" }, { id: "ata-meken" }, { id: "ar-namys" }],
      generationProvenance: { byPath: { "government.coalitionPartyIds": { source: "generated" } } },
    },
  );
  assert.deepEqual(kyrgyz.proposal.actorPatch.government.coalitionPartyIds, ["ata-meken", "ar-namys"]);
  assert.equal(historicalChallengeStillAppliesToEntry({
    challengedFacts: [{ path: "government.coalitionPartyIds", display: "[\"respublika\",\"ata-meken\"]" }],
  }, kyrgyz), false);
});

test("coarse generated government ownership rebases a stale party-government claim to an explicit empty set", () => {
  const fiji = rebasePoliticalWorldVerificationEntry(
    baseEntry("Republic of Fiji", { government: { rulingPartyIds: ["fijifirst"] } }),
    {
      polityKey: "Republic of Fiji",
      government: {
        form: "Military-Backed Republic",
        rulingPartyIds: [],
        coalitionPartyIds: [],
      },
      generationProvenance: { byPath: { government: { source: "generated" } } },
    },
  );
  assert.deepEqual(fiji.proposal.actorPatch.government.rulingPartyIds, []);
  assert.equal(historicalChallengeStillAppliesToEntry({
    challengedFacts: [{ path: "government.rulingPartyIds", display: "[\"fijifirst\"]" }],
  }, fiji), false);
});

test("an unchanged concrete challenged fact keeps the sticky temporal correction obligation", () => {
  const entry = baseEntry("Republic A", { government: { rulingPartyIds: ["party-a"] } });
  assert.equal(historicalChallengeStillAppliesToEntry({
    challengedFacts: [{ path: "government.rulingPartyIds", display: "[\"party-a\"]" }],
  }, entry), true);
});

test("complex challenged paths fail closed instead of silently clearing an obligation", () => {
  const entry = baseEntry("Republic A", { parties: [{ id: "party-a", name: "Party A" }] });
  assert.equal(historicalChallengeStillAppliesToEntry({
    challengedFacts: [{ path: "parties[0].identity", display: "{\"id\":\"party-a\",\"name\":\"Party A\"}" }],
  }, entry), true);
});
