import test from "node:test";
import assert from "node:assert/strict";
import {
  applyInstitutionGovernanceCommand,
  INSTITUTION_GOVERNANCE_ERROR_CODES,
} from "../../runtime/institutionalGovernance.js";
import {
  createVotingRuleRetry,
  GOVERNANCE_BACKFILL_STALE,
  votingRuleMissingMessage,
} from "./institutionGovernanceRetry.js";

// A council whose charter has no voting rule, with a proposal ready to vote on.
const unruledWorld = () => ({
  polityOverrides: {
    A: { code: "A", name: "A", status: "active", aliases: [] },
    B: { code: "B", name: "B", status: "active", aliases: [] },
  },
  institutions: {
    schemaVersion: 1,
    byId: {
      council: {
        id: "council",
        name: "Old Council",
        status: "active",
        charter: {},
        members: [{ polity: "A", status: "member" }, { polity: "B", status: "member" }],
        proposals: { p1: { id: "p1", title: "Motion", status: "debate", createdBy: "A", sponsorPolities: ["A"] } },
      },
    },
  },
});

// Stands in for the canonical store: each commit reads the world afresh, as
// commitInstitutionalPlayerVoteRequest does inside mutateCanonicalTurnState.
const store = () => {
  const state = { world: unruledWorld() };
  const commit = () => {
    const result = applyInstitutionGovernanceCommand({
      world: state.world, chats: [], events: [], institutionId: "council", playerCountry: "A", date: "2000-01-01",
      command: { type: "submit-for-vote", proposalId: "p1", requester: "A" },
    });
    state.world = result.world;
    return result;
  };
  return { state, commit };
};

test("a vote refused for want of a voting rule is backfilled once and the whole commit re-run", async () => {
  const { state, commit } = store();
  const calls = [];
  const retry = createVotingRuleRetry({
    backfill: async (options) => {
      calls.push(options);
      state.world.institutions.byId.council.charter = { votingRule: { type: "simple-majority", quorum: 0.5, eligibleStatuses: ["member"] } };
    },
  });
  const result = await retry(commit, { institutionId: "council", proposalId: "p1", expectedGameId: "game-1" });
  assert.equal(result.proposal.status, "voting");
  assert.deepEqual(calls, [{ institutionId: "council", proposalId: "p1", expectedGameId: "game-1" }]);
});

test("the resolver is asked once per campaign and institution; after that the player reads what to expect", async () => {
  const { commit } = store();
  let calls = 0;
  const retry = createVotingRuleRetry({ backfill: async () => { calls += 1; } });
  await assert.rejects(retry(commit, { institutionId: "council", proposalId: "p1", expectedGameId: "game-1" }), (error) => (
    error.code === INSTITUTION_GOVERNANCE_ERROR_CODES.VOTING_RULE_UNSPECIFIED && error.message === votingRuleMissingMessage("Old Council")
  ));
  await assert.rejects(retry(commit, { institutionId: "council", proposalId: "p1", expectedGameId: "game-1" }), (error) => (
    error.message === votingRuleMissingMessage("Old Council")
  ));
  assert.equal(calls, 1);
  assert.equal(votingRuleMissingMessage("Old Council"), "Old Council has no voting rule in its charter, so it cannot hold a formal vote yet. Its members can still debate the proposal.");
});

test("no request while a turn is being written, and a stale resolution may be asked again", async () => {
  const { commit } = store();
  let busy = true;
  let calls = 0;
  const retry = createVotingRuleRetry({
    busy: () => busy,
    backfill: async () => {
      calls += 1;
      throw Object.assign(new Error("Campaign advanced while institutional voting rules were being resolved."), { code: GOVERNANCE_BACKFILL_STALE });
    },
  });
  await assert.rejects(retry(commit, { institutionId: "council", proposalId: "p1" }), /still updating/);
  assert.equal(calls, 0);
  busy = false;
  await assert.rejects(retry(commit, { institutionId: "council", proposalId: "p1" }), /Campaign advanced/);
  await assert.rejects(retry(commit, { institutionId: "council", proposalId: "p1" }), /Campaign advanced/);
  assert.equal(calls, 2);
});

test("any other failure passes straight through without a request", async () => {
  let calls = 0;
  const retry = createVotingRuleRetry({ backfill: async () => { calls += 1; } });
  await assert.rejects(retry(async () => { throw new Error("Only a current sponsor may submit this proposal for a formal vote."); }), /current sponsor/);
  assert.equal(calls, 0);
});

test("an AI sponsor's refused submit keeps its code and command, so the chat turn can retry it", async () => {
  const { applyInstitutionalChatGovernanceBatch } = await import("../../runtime/institutionalGovernance.js");
  const result = applyInstitutionalChatGovernanceBatch({
    world: unruledWorld(), chats: [], events: [], institutionId: "council", playerCountry: "B", date: "2000-01-01",
    formalActions: [{ type: "institution_submit_proposal", actorName: "A", proposalId: "p1" }],
  });
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].code, INSTITUTION_GOVERNANCE_ERROR_CODES.VOTING_RULE_UNSPECIFIED);
  assert.deepEqual(result.rejected[0].command, { type: "submit-for-vote", proposalId: "p1", requester: "A" });
});
