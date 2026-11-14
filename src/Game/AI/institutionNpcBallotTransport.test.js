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

// The type word is never read for what it seems to mean: an action that has a speaker and words is a message by its
// shape, whatever its type says, "speak" or its French twin "parler" alike; one that has neither is left for the schema.
test("an action with a speaker and words is a message by its shape, in any language; another type word is not read", () => {
  const read = (type) => normalizeGameplayPayload("chatActions", [{ type, polity: "Austria-Hungary", content: "Vienna supports the motion." }]).actions[0];
  for (const type of ["speak", "parler", "say", "dire", "message", undefined]) {
    assert.deepEqual(read(type), { type: "send_message", actorName: "Austria-Hungary", content: "Vienna supports the motion." }, String(type));
  }
  assert.equal(read("Send Message").type, "send_message", "the schema's own word, its spaces and case aside");
  const silent = normalizeGameplayPayload("chatActions", [{ type: "applaudir", polity: "Austria-Hungary" }]).actions[0];
  assert.equal(silent.type, "applaudir", "no words, no speaker's message: left as written");
  assert.equal(validateGameplayPayload("chatActions", { actions: [silent] }).valid, false);
});

test("raw Council action arrays and the polity field name normalize without inventing authority", () => {
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
