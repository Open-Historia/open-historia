import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";
import { normalizeInstitutionChatAction } from "./institutionChatActions.js";

const proposalId = "invitation-romania-mitteleuropa-invitation-romania-1913-06-16";

test("raw Council vote aliases normalize before chat schema validation", () => {
  const normalized = normalizeGameplayPayload("chatActions", {
    actions: [{
      action: "institution_vote",
      actorName: "Austria-Hungary",
      institutionId: "mitteleuropa",
      proposalId,
      vote: "yes",
    }],
  });
  assert.deepEqual(normalized.actions[0], {
    type: "institution_vote",
    actorName: "Austria-Hungary",
    proposalId,
    voteChoice: "yes",
  });
  assert.equal(validateGameplayPayload("chatActions", normalized).valid, true);
  assert.deepEqual(normalizeInstitutionChatAction(normalized.actions[0]), normalized.actions[0]);
});

test("raw Council action arrays and speak/polity aliases normalize without inventing authority", () => {
  const normalized = normalizeGameplayPayload("chatActions", [
    { type: "speak", polity: "Austria-Hungary", content: "Vienna supports the motion." },
    { type: "institution_vote", polity: "Austria-Hungary", institutionId: "wrong-id", proposalId, choice: "yes" },
  ]);
  assert.deepEqual(normalized, {
    actions: [
      { type: "send_message", actorName: "Austria-Hungary", content: "Vienna supports the motion." },
      { type: "institution_vote", actorName: "Austria-Hungary", proposalId, voteChoice: "yes" },
    ],
  });
  assert.equal(validateGameplayPayload("chatActions", normalized).valid, true);
});
