import test from "node:test";
import assert from "node:assert/strict";

import { generatePoliticalWorldProposalsCore } from "./politicalWorldGeneratorCore.js";

const polityKey = "Crown of Aster";
const historyAuthority = Object.freeze({
  referenceAuthority: "none",
  referenceAllowed: false,
  cutoffDate: "",
  cutoffInclusive: false,
});

const validPatch = () => ({
  politicalSystem: {
    type: "presidential_republic",
    representation: "electoral",
    regimeCharacter: "democratic",
  },
  government: { form: "Presidential republic" },
  parties: [{ id: "civic-league", name: "Civic League" }],
});

const generate = (wireProposal) => generatePoliticalWorldProposalsCore({
  scenarioDate: "2026-01-01",
  historyAuthority,
  polities: [polityKey],
  politicalActors: { byPolity: {} },
  maxAttempts: 1,
  generatedAt: "2026-11-16T20:06:27.675Z",
  callModel: async () => ({
    toolInput: {
      proposals: [{
        polityKey,
        confidence: "moderate",
        sourceAsOf: "",
        referenceDates: [],
        ...wireProposal,
      }],
    },
  }),
});

test("PW generator accepts a provider-structured actorPatchJson object only through native validation", async () => {
  // A live November 16 batch returned actorPatchJson as an object, despite
  // the shallow tool schema requesting JSON text. The contents must go through
  // precisely the same projection, authority and canonical checks as text.
  const result = await generate({ actorPatchJson: validPatch() });
  assert.equal(result.generatedPolities, 1);
  assert.equal(result.failedPolities, 0);
  assert.equal(result.proposals[0].validation.actor.parties[0].id, "civic-league");
  assert.equal(result.proposals[0].validation.actor.politicalSystem.representation, "electoral");
});

test("PW generator still rejects malformed actorPatchJson arrays", async () => {
  const result = await generate({ actorPatchJson: [validPatch()] });
  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.match(result.failures[0].errors.join(" "), /did not contain a parseable JSON object/i);
});

test("PW generator rejects forbidden external reference dates even with structured object transport", async () => {
  const result = await generate({
    actorPatchJson: validPatch(),
    sourceAsOf: "2025-12-31",
    referenceDates: ["2021-01-10"],
  });
  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.match(result.failures[0].errors.join(" "), /no external-reference authority/i);
});

const nestedPatch = () => ({
  ...validPatch(),
  parties: [{
    id: "civic-league",
    name: "Civic League",
    politicalResponse: {
      organization: 75,
      issues: { institutional_reform: { position: 30, sensitivity: 60, strainResponse: 15 } },
    },
  }],
});

const omitTrailingEntityCloser = (json) => {
  const arrayEnd = json.lastIndexOf("]");
  assert.ok(arrayEnd > 0);
  assert.equal(json[arrayEnd - 1], "}");
  return json.slice(0, arrayEnd - 1) + json.slice(arrayEnd);
};

test("PW generator recovers exactly one missing final entity brace from provider JSON text", async () => {
  // Reproduces the four November 16 retry strings: ...}}]} instead of ...}}}]}.
  const malformed = omitTrailingEntityCloser(JSON.stringify(nestedPatch()));
  assert.throws(() => JSON.parse(malformed), SyntaxError);
  const result = await generate({ actorPatchJson: malformed });
  assert.equal(result.generatedPolities, 1);
  assert.equal(result.failedPolities, 0);
  assert.equal(result.proposals[0].validation.actor.parties[0].id, "civic-league");
  // The standard-depth requested-scope projection intentionally excludes
  // unrequested hidden response fields, but parsing must preserve their syntax.
  assert.equal(result.diagnostics[0].polities[0].parsedActorPatch.parties[0].politicalResponse.issues.institutional_reform.position, 30);
});

test("PW generator does not heal two missing braces or arbitrary JSON corruption", async () => {
  const malformed = omitTrailingEntityCloser(omitTrailingEntityCloser(JSON.stringify(nestedPatch())));
  const result = await generate({ actorPatchJson: malformed });
  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.match(result.failures[0].errors.join(" "), /did not contain a parseable JSON object/i);
});

test("PW generator still validates party references after a one-brace transport recovery", async () => {
  const actorPatch = nestedPatch();
  actorPatch.government.rulingPartyIds = ["nonexistent-party"];
  const result = await generate({ actorPatchJson: omitTrailingEntityCloser(JSON.stringify(actorPatch)) });
  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.match(result.failures[0].errors.join(" "), /references unknown party id nonexistent-party/i);
});
