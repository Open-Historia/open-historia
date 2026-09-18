import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInstitutionChatAction, partitionInstitutionChatActions } from "./institutionChatActions.js";

test("normalizes formal institutional actions without treating chat prose as law", () => {
  assert.deepEqual(normalizeInstitutionChatAction({
    type: "institution_vote", actorName: "France", proposalId: "aid-package", voteChoice: "YES", reason: "Support.",
  }), {
    type: "institution_vote", actorName: "France", proposalId: "aid-package", voteChoice: "yes", reason: "Support.",
  });
  assert.equal(normalizeInstitutionChatAction({ type: "send_message", actorName: "France", content: "Aye." }), null);
  assert.equal(normalizeInstitutionChatAction({ type: "institution_vote", actorName: "France", proposalId: "aid-package", voteChoice: "maybe" }), null);
});

test("partitions formal governance actions from ordinary Beta chat actions", () => {
  const source = [
    { type: "send_message", actorName: "France", content: "We support it." },
    { type: "institution_lodge_proposal", actorName: "Germany", title: "Aid", summary: "Approve assistance." },
  ];
  const result = partitionInstitutionChatActions(source);
  assert.equal(result.formal.length, 1);
  assert.equal(result.conversational.length, 1);
  assert.equal(result.formal[0].proposalType, "resolution");
});
