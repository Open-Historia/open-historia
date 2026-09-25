/*! Open Historia Continuum — deterministic institution proposal/voting regressions */
import assert from "node:assert/strict";
import test from "node:test";
import {
  addInstitutionProposalAmendment,
  applyInstitutionGovernanceCommand,
  castInstitutionProposalVote,
  castInstitutionProposalVoteBatch,
  closeInstitutionProposalVoting,
  createInstitutionProposal,
  institutionEligibleVoters,
  institutionCanTableProposal,
  institutionCanProposeAmendment,
  implementInstitutionProposal,
  openInstitutionProposalVoting,
  lodgeInstitutionProposal,
  submitInstitutionProposalForVoting,
  resolveInstitutionProposalAmendment,
  tallyInstitutionBallot,
  transitionInstitutionProposal,
} from "./institutionalGovernance.js";
import { normalizeInstitutions } from "./institutions.js";

const makeWorld = (rule = null) => ({
  polityOverrides: {
    A: { code: "A", name: "Player Republic", status: "active", aliases: [] },
    B: { code: "B", name: "B Republic", status: "active", aliases: [] },
    C: { code: "C", name: "C Republic", status: "active", aliases: [] },
    D: { code: "D", name: "D Republic", status: "active", aliases: [] },
  },
  politicalActors: { schemaVersion: 1, byPolity: {} },
  countryStats: {},
  powerStatus: { schemaVersion: 1, byPolity: {} },
  institutions: {
    schemaVersion: 1,
    ledgerVersion: 1,
    byId: {
      council: {
        id: "council",
        name: "Continental Council",
        status: "active",
        charter: rule ? { votingRule: rule } : {},
        members: [
          { polity: "A", status: "member", role: "member" },
          { polity: "B", status: "member", role: "leader" },
          { polity: "C", status: "member", role: "member" },
          { polity: "D", status: "observer", role: "member" },
        ],
      },
    },
  },
});

const simpleRule = { type: "simple-majority", quorum: 0.5, eligibleStatuses: ["member"] };

const formalizedProposalWorld = (rule = simpleRule, extraProposal = {}) => {
  let result = createInstitutionProposal({
    world: makeWorld(rule), institutionId: "council", date: "2000-01-01",
    proposal: { id: "p1", title: "Joint Program", type: "program", createdBy: "A", ...extraProposal },
  });
  result = transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "debate", date: "2000-01-02" });
  result = transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "formalized", date: "2000-01-03" });
  return result.world;
};

const open = (rule = simpleRule, extraProposal = {}) => openInstitutionProposalVoting({
  world: formalizedProposalWorld(rule, extraProposal), institutionId: "council", proposalId: "p1", date: "2000-01-04",
});

const vote = (world, polity, choice, authority = polity === "A" ? "player" : "npc", government = "Gov") => castInstitutionProposalVote({
  world, institutionId: "council", proposalId: "p1", polity, choice, date: "2000-01-05",
  government, playerCountry: "A", authority,
});

test("unconfigured institution fails closed with a typed migration signal instead of inventing a majority rule", () => {
  const world = formalizedProposalWorld(null);
  assert.throws(
    () => openInstitutionProposalVoting({ world, institutionId: "council", proposalId: "p1" }),
    (error) => error?.code === "institution-voting-rule-unspecified" && /no canonical voting rule/i.test(error.message),
  );
});

test("eligible voters come from canonical membership status, not chat participants", () => {
  const world = makeWorld(simpleRule);
  const institution = normalizeInstitutions(world.institutions, world).byId.council;
  assert.deepEqual(institutionEligibleVoters(institution, institution.charter.votingRule), ["A", "B", "C"]);
});

test("opening voting snapshots rule and eligible voters", () => {
  const result = open();
  assert.equal(result.proposal.status, "voting");
  assert.equal(result.proposal.voting.rule.type, "simple-majority");
  assert.deepEqual(result.proposal.voting.eligibleVoters, ["A", "B", "C"]);
  assert.deepEqual(result.proposal.voting.ballots, {});
});

test("membership changes after opening do not retroactively change eligibility", () => {
  const result = open();
  result.world.institutions.byId.council.members = [
    { polity: "A", status: "member", role: "member" },
    { polity: "D", status: "member", role: "member" },
  ];
  const normalized = normalizeInstitutions(result.world.institutions, result.world);
  assert.deepEqual(normalized.byId.council.proposals.p1.voting.eligibleVoters, ["A", "B", "C"]);
  assert.throws(
    () => castInstitutionProposalVote({
      world: result.world, institutionId: "council", proposalId: "p1", polity: "D", choice: "yes", authority: "npc", playerCountry: "A",
    }),
    /not eligible/i,
  );
});

test("NPC authority cannot manufacture the player's institutional vote", () => {
  const result = open();
  assert.throws(
    () => vote(result.world, "A", "yes", "npc"),
    /cannot cast the player's/i,
  );
});

test("player authority cannot cast another polity's vote", () => {
  const result = open();
  assert.throws(
    () => vote(result.world, "B", "yes", "player"),
    /cannot cast another polity/i,
  );
});

test("ballot records historically queryable government and reason", () => {
  const result = open();
  const cast = castInstitutionProposalVote({
    world: result.world, institutionId: "council", proposalId: "p1", polity: "A", choice: "yes",
    date: "2000-01-05", government: "Coalition Alpha", reason: "Supports the program", playerCountry: "A", authority: "player",
  });
  assert.deepEqual(cast.ballot, {
    polity: "A", choice: "yes", date: "2000-01-05", government: "Coalition Alpha", reason: "Supports the program",
  });
});

test("simple majority resolves deterministically after quorum", () => {
  let result = open();
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "yes");
  result = vote(result.world, "C", "no");
  const closed = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1", date: "2000-01-06" });
  assert.equal(closed.outcome.status, "passed");
  assert.equal(closed.outcome.yes, 2);
  assert.equal(closed.outcome.no, 1);
  assert.equal(closed.proposal.status, "passed");
});

test("quorum failure is deterministic and does not let AI prose declare passage", () => {
  let result = open({ type: "simple-majority", quorum: 1, eligibleStatuses: ["member"] });
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "yes");
  const closed = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  assert.equal(closed.outcome.status, "failed");
  assert.equal(closed.outcome.reason, "quorum-not-met");
});

test("unanimity requires every snapshotted eligible voter to vote yes", () => {
  let result = open({ type: "unanimity", quorum: 1, eligibleStatuses: ["member"] });
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "yes");
  result = vote(result.world, "C", "abstain");
  const closed = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  assert.equal(closed.outcome.status, "failed");
  assert.equal(closed.outcome.reason, "unanimity-not-met");
});

test("consensus permits abstention but fails on an objection", () => {
  let pass = open({ type: "consensus", quorum: 2 / 3, eligibleStatuses: ["member"] });
  pass = vote(pass.world, "A", "yes");
  pass = vote(pass.world, "B", "abstain");
  let closed = closeInstitutionProposalVoting({ world: pass.world, institutionId: "council", proposalId: "p1" });
  assert.equal(closed.outcome.status, "passed");

  let fail = open({ type: "consensus", quorum: 2 / 3, eligibleStatuses: ["member"] });
  fail = vote(fail.world, "A", "yes");
  fail = vote(fail.world, "B", "no");
  closed = closeInstitutionProposalVoting({ world: fail.world, institutionId: "council", proposalId: "p1" });
  assert.equal(closed.outcome.status, "failed");
  assert.equal(closed.outcome.reason, "consensus-objection");
});

test("veto is available only to charter-authorized holders and overrides threshold", () => {
  const rule = { type: "simple-majority", quorum: 0.5, vetoRoles: ["leader"], eligibleStatuses: ["member"] };
  let result = open(rule);
  assert.throws(() => vote(result.world, "C", "veto"), /does not hold veto authority/i);
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "veto");
  result = vote(result.world, "C", "yes");
  const closed = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  assert.equal(closed.outcome.status, "vetoed");
  assert.deepEqual(closed.outcome.vetoPolities, ["B"]);
});

test("charter can declare a veto-holder's negative vote to exercise veto automatically", () => {
  const rule = { type: "simple-majority", quorum: 0.5, vetoRoles: ["leader"], negativeVoteIsVeto: true, eligibleStatuses: ["member"] };
  let result = open(rule);
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "no");
  result = vote(result.world, "C", "yes");
  const closed = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  assert.equal(closed.outcome.status, "vetoed");
});

test("weighted voting uses canonical charter weights", () => {
  const rule = {
    type: "weighted", threshold: 0.5, quorum: 0.5, eligibleStatuses: ["member"],
    weightsByPolity: { A: 5, B: 1, C: 1 },
  };
  let result = open(rule);
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "no");
  result = vote(result.world, "C", "no");
  const closed = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  assert.equal(closed.outcome.status, "passed");
  assert.equal(closed.outcome.yesWeight, 5);
  assert.equal(closed.outcome.noWeight, 2);
});

test("proposal-type charter rule overrides the institution default", () => {
  const world = makeWorld(simpleRule);
  world.institutions.byId.council.charter = {
    votingRule: simpleRule,
    proposalRules: {
      accession: { type: "unanimity", quorum: 1, eligibleStatuses: ["member"] },
    },
  };
  let result = createInstitutionProposal({ world, institutionId: "council", proposal: { id: "p1", title: "Admit D", type: "accession" } });
  result = transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "debate" });
  result = transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "formalized" });
  const opened = openInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  assert.equal(opened.proposal.voting.rule.type, "unanimity");
});

test("amendment lifecycle is persistent, authority-bound, and returns to debate when resolved", () => {
  let result = createInstitutionProposal({ world: makeWorld(simpleRule), institutionId: "council", proposal: { id: "p1", title: "Program", createdBy: "A", sponsorPolities: ["A"] } });
  result = transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "debate" });
  const institution = normalizeInstitutions(result.world.institutions, result.world).byId.council;
  assert.equal(institutionCanProposeAmendment(institution, "B", result.proposal), true);
  result = addInstitutionProposalAmendment({
    world: result.world, institutionId: "council", proposalId: "p1", proposer: "B", date: "2000-01-02",
    amendment: { id: "a1", text: "Reduce contribution to 2%.", proposedBy: "C" },
  });
  assert.equal(result.proposal.status, "amendment");
  assert.equal(result.proposal.amendments[0].status, "proposed");
  assert.equal(result.proposal.amendments[0].proposedBy, "B", "native caller identity overrides amendment payload speaker");
  assert.throws(() => resolveInstitutionProposalAmendment({
    world: result.world, institutionId: "council", proposalId: "p1", amendmentId: "a1", status: "accepted", requester: "C", date: "2000-01-03",
  }), /not a current sponsor/i);
  result = resolveInstitutionProposalAmendment({
    world: result.world, institutionId: "council", proposalId: "p1", amendmentId: "a1", status: "accepted", requester: "A", date: "2000-01-03",
  });
  assert.equal(result.proposal.amendments[0].status, "accepted");
  assert.equal(result.proposal.amendments[0].resolvedBy, "A");
  assert.equal(result.proposal.status, "debate");
});

test("only the amendment author may withdraw it; suspended/observer members cannot create member-only amendments", () => {
  let result = createInstitutionProposal({ world: makeWorld(simpleRule), institutionId: "council", proposal: { id: "p1", title: "Program", createdBy: "A" } });
  result = transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "debate" });
  assert.throws(() => addInstitutionProposalAmendment({
    world: result.world, institutionId: "council", proposalId: "p1", proposer: "D", amendment: { text: "Observer text" },
  }), /not eligible to propose/i);
  result = addInstitutionProposalAmendment({
    world: result.world, institutionId: "council", proposalId: "p1", proposer: "B", amendment: { id: "a1", text: "Clause" },
  });
  assert.throws(() => resolveInstitutionProposalAmendment({
    world: result.world, institutionId: "council", proposalId: "p1", amendmentId: "a1", status: "withdrawn", requester: "C",
  }), /only B may withdraw/i);
  const withdrawn = resolveInstitutionProposalAmendment({
    world: result.world, institutionId: "council", proposalId: "p1", amendmentId: "a1", status: "withdrawn", requester: "B",
  });
  assert.equal(withdrawn.proposal.amendments[0].status, "withdrawn");
  assert.equal(withdrawn.proposal.status, "debate");
});

test("accepted structured amendment revision changes the proposition before voting", () => {
  let result = createInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council",
    proposal: { id: "p1", title: "Original Program", summary: "Spend 4%.", createdBy: "A", sponsorPolities: ["A"] },
  });
  result = transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "debate" });
  result = addInstitutionProposalAmendment({
    world: result.world, institutionId: "council", proposalId: "p1", proposer: "B",
    amendment: { id: "a1", text: "Reduce the contribution.", revision: { summary: "Spend 2%." } },
  });
  result = resolveInstitutionProposalAmendment({
    world: result.world, institutionId: "council", proposalId: "p1", amendmentId: "a1", status: "accepted", requester: "A",
  });
  assert.equal(result.proposal.summary, "Spend 2%.");
  assert.equal(result.proposal.amendments[0].revisionApplied, true);
  const opened = submitInstitutionProposalForVoting({ world: result.world, institutionId: "council", proposalId: "p1", requester: "A" });
  assert.equal(opened.proposal.status, "voting");
});

test("accepted text-only amendment blocks stale executable consequences until explicitly reconciled", () => {
  let result = createInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council",
    proposal: {
      id: "p1", title: "Joint Commitment", createdBy: "A", sponsorPolities: ["A"],
      consequences: [{ id: "c1", kind: "agreement", payload: { id: "treaty", op: "start", parties: ["A", "B"], title: "Treaty" } }],
    },
  });
  result = transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "debate" });
  result = addInstitutionProposalAmendment({ world: result.world, institutionId: "council", proposalId: "p1", proposer: "B", amendment: { id: "a1", text: "Narrow the commitment substantially." } });
  result = resolveInstitutionProposalAmendment({ world: result.world, institutionId: "council", proposalId: "p1", amendmentId: "a1", status: "accepted", requester: "A" });
  result = transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "formalized" });
  result = openInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  result = castInstitutionProposalVoteBatch({ world: result.world, institutionId: "council", proposalId: "p1", playerCountry: "", ballots: [
    { polity: "A", choice: "yes" }, { polity: "B", choice: "yes" }, { polity: "C", choice: "yes" },
  ] });
  result = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  assert.equal(result.proposal.status, "passed");
  const implemented = implementInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1" });
  assert.equal(implemented.implementation.status, "blocked");
  assert.match(implemented.implementation.note, /accepted amendment text changed/i);
  assert.match(implemented.implementation.pending[0].blockedReason, /explicit consequence reconciliation/i);
});

test("invalid proposal lifecycle transitions fail closed", () => {
  const result = createInstitutionProposal({ world: makeWorld(simpleRule), institutionId: "council", proposal: { id: "p1", title: "Program" } });
  assert.throws(
    () => transitionInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "p1", status: "voting" }),
    /cannot transition/i,
  );
});

test("institution governance command mirrors legal transitions into the persistent channel without making chat authoritative", () => {
  let state = applyInstitutionGovernanceCommand({
    world: makeWorld(simpleRule), chats: [], institutionId: "council", playerCountry: "A", date: "2000-01-01",
    command: { type: "create", proposal: { id: "p1", title: "Joint Program", createdBy: "A" } },
  });
  const channelId = state.channel.id;
  const createdMessages = state.channel.messages.length;
  assert.equal(state.world.institutions.byId.council.channelId, channelId);
  assert.equal(state.world.institutions.byId.council.proposals.p1.status, "draft");
  assert.ok(state.channel.messages.some((message) => /proposal opened/i.test(message.text)));

  state = applyInstitutionGovernanceCommand({
    world: state.world, chats: state.chats, institutionId: "council", playerCountry: "A", date: "2000-01-02",
    command: { type: "status", proposalId: "p1", status: "debate" },
  });
  assert.equal(state.channel.id, channelId);
  assert.equal(state.world.institutions.byId.council.proposals.p1.status, "debate");
  assert.equal(state.channel.messages.length, createdMessages + 1);
});

test("proposal consequence intents normalize to a bounded canonical contract without executing chat/vote prose", () => {
  const consequence = {
    kind: "agreement", op: "start",
    payload: { id: "joint-program", title: "Joint Program", parties: ["A", "B"], worldPatch: { hacked: true } },
  };
  const result = createInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council",
    proposal: { id: "p1", title: "Joint Program", consequences: [consequence] },
  });
  assert.deepEqual(result.proposal.consequences, [{
    id: "agreement-1",
    kind: "agreement",
    payload: {
      id: "joint-program", op: "start", type: "", parties: ["A", "B"],
      title: "Joint Program", terms: "",
    },
  }]);
  assert.equal(result.world.agreements, undefined);
  assert.equal("worldPatch" in result.proposal.consequences[0].payload, false);
});

test("proposal consequence aliases become semantic authorization intents rather than executable unit/world patches", () => {
  const result = createInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council",
    proposal: {
      id: "p1", title: "Forward Presence",
      consequences: [{ kind: "deployment", summary: "Authorize a deployment", payload: { region: "North", unitOps: [{ op: "move" }], authorityRef: "fake" } }],
    },
  });
  const intent = result.proposal.consequences[0];
  assert.equal(intent.kind, "deployment-authorization");
  assert.equal(intent.note, "Authorize a deployment");
  assert.equal(intent.payload.region, "North");
  assert.equal("unitOps" in intent.payload, false);
  assert.equal("authorityRef" in intent.payload, false);
});

test("unknown future consequence kinds remain bounded custom pending intent with their requested kind preserved", () => {
  const huge = "x".repeat(5000);
  const result = createInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council",
    proposal: { id: "p1", title: "Future Rule", consequences: [{ kind: "quantum-custom", payload: { detail: huge, world: { hacked: true } } }] },
  });
  const intent = result.proposal.consequences[0];
  assert.equal(intent.kind, "custom");
  assert.equal(intent.requestedKind, "quantum-custom");
  assert.equal(intent.payload.detail.length, 1200);
  assert.equal("world" in intent.payload, false);
});

test("tally is pure: it cannot change proposal state by itself", () => {
  let result = open();
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "yes");
  const proposal = result.proposal;
  const outcome = tallyInstitutionBallot({ institution: result.institution, proposal });
  assert.equal(outcome.status, "passed");
  assert.equal(proposal.status, "voting");
});

test("passed membership resolution materializes through the institution owner with proposal provenance", () => {
  let result = open(simpleRule, {
    type: "accession",
    consequences: [{ id: "admit-d", kind: "institution-membership", op: "join", polity: "D", status: "member" }],
  });
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "yes");
  result = vote(result.world, "C", "yes");
  result = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1", date: "2000-01-06" });
  const implemented = applyInstitutionGovernanceCommand({
    world: result.world, chats: [], institutionId: "council", playerCountry: "A", date: "2000-01-07",
    command: { type: "implement", proposalId: "p1" },
  });
  const member = implemented.world.institutions.byId.council.members.find((entry) => entry.polity === "D");
  assert.equal(member.status, "member");
  assert.deepEqual(member.sourceProposalIds, ["p1"]);
  assert.equal(implemented.proposal.status, "implementation");
  assert.equal(implemented.proposal.implementation.status, "complete");
  assert.deepEqual(implemented.proposal.implementation.applied.map((entry) => entry.id), ["admit-d"]);
});

test("passed charter amendment materializes through the institution owner", () => {
  let result = open(simpleRule, {
    type: "charter-amendment",
    consequences: [{
      id: "require-consensus",
      kind: "institution-charter",
      charterPatch: { votingRule: { type: "consensus", quorum: 1, eligibleStatuses: ["member"] } },
    }],
  });
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "yes");
  result = vote(result.world, "C", "yes");
  result = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  const implemented = applyInstitutionGovernanceCommand({
    world: result.world, chats: [], institutionId: "council", playerCountry: "A",
    command: { type: "implement", proposalId: "p1" },
  });
  assert.equal(implemented.world.institutions.byId.council.charter.votingRule.type, "consensus");
  assert.equal(implemented.proposal.implementation.status, "complete");
});

test("consequences owned by another canonical domain remain explicit pending work rather than being guessed", () => {
  let result = open(simpleRule, {
    consequences: [{ id: "formal-pact", kind: "agreement", op: "start", payload: { id: "joint-pact" } }],
  });
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "yes");
  result = vote(result.world, "C", "yes");
  result = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  const implemented = applyInstitutionGovernanceCommand({
    world: result.world, chats: [], institutionId: "council", playerCountry: "A",
    command: { type: "implement", proposalId: "p1" },
  });
  assert.equal(implemented.proposal.implementation.status, "blocked");
  assert.equal(implemented.proposal.implementation.pending[0].kind, "agreement");
  assert.equal(implemented.world.agreements, undefined);
});

test("institutional vote cannot autonomously enroll the player without explicit player accession consent", () => {
  let result = open(simpleRule, {
    type: "accession",
    consequences: [{ id: "admit-player", kind: "institution-membership", op: "join", polity: "A", status: "member" }],
  });
  // Simulate a proposal sponsored by B rather than the player, while preserving
  // A as a snapshotted voter who never cast an affirmative ballot.
  result.world.institutions.byId.council.proposals.p1.createdBy = "B";
  result.world.institutions.byId.council.proposals.p1.sponsorPolities = ["B"];
  result = vote(result.world, "B", "yes");
  result = vote(result.world, "C", "yes");
  const closed = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1", date: "2000-01-06" });
  // Force the legal proposal to passed for implementation-unit isolation: the
  // implementation boundary itself must still demand explicit player assent.
  closed.world.institutions.byId.council.proposals.p1.status = "passed";
  const implemented = applyInstitutionGovernanceCommand({
    world: closed.world, chats: [], institutionId: "council", playerCountry: "A", date: "2000-01-07",
    command: { type: "implement", proposalId: "p1" },
  });
  assert.equal(implemented.proposal.implementation.status, "blocked");
  assert.match(implemented.proposal.implementation.pending[0].blockedReason, /explicit player/i);
});

test("player-sponsored accession application is sufficient native consent for a passed institutional admission", () => {
  let result = createInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council", date: "2000-01-01",
    proposal: {
      id: "join-a", title: "A accession", type: "accession", createdBy: "A", sponsorPolities: ["A"],
      status: "passed", consequences: [{ id: "admit-a", kind: "institution-membership", op: "join", polity: "A", status: "member" }],
    },
  });
  // createInstitutionProposal normalizes lifecycle to draft; isolate implementation
  // by promoting the already-canonical proposal to a passed resolution.
  result.world.institutions.byId.council.proposals["join-a"].status = "passed";
  const implemented = applyInstitutionGovernanceCommand({
    world: result.world, chats: [], institutionId: "council", playerCountry: "A", date: "2000-01-02",
    command: { type: "implement", proposalId: "join-a" },
  });
  assert.equal(implemented.proposal.implementation.status, "complete");
});

test("institution-owned implementation is idempotent", () => {
  let result = open(simpleRule, {
    consequences: [{ id: "admit-d", kind: "membership", op: "join", polity: "D", status: "member" }],
  });
  result = vote(result.world, "A", "yes");
  result = vote(result.world, "B", "yes");
  result = vote(result.world, "C", "yes");
  result = closeInstitutionProposalVoting({ world: result.world, institutionId: "council", proposalId: "p1" });
  let implemented = applyInstitutionGovernanceCommand({
    world: result.world, chats: [], institutionId: "council", playerCountry: "A",
    command: { type: "implement", proposalId: "p1" },
  });
  implemented = applyInstitutionGovernanceCommand({
    world: implemented.world, chats: implemented.chats, institutionId: "council", playerCountry: "A",
    command: { type: "implement", proposalId: "p1" },
  });
  assert.equal(implemented.proposal.implementation.applied.filter((entry) => entry.id === "admit-d").length, 1);
  assert.equal(implemented.world.institutions.byId.council.members.filter((entry) => entry.polity === "D").length, 1);
});

test("formal ballots are immutable once recorded", () => {
  let result = open();
  result = vote(result.world, "B", "yes");
  assert.throws(
    () => vote(result.world, "B", "no"),
    /already cast/i,
  );
  assert.equal(result.proposal.voting.ballots.B.choice, "yes");
});

test("NPC ballot batch is atomic, cannot include player, and snapshots canonical governments", () => {
  let result = open();
  result.world.politicalActors.byPolity.B = { polityKey: "B", government: { form: "Parliamentary republic", headOfGovernment: "Prime B" } };
  result.world.politicalActors.byPolity.C = { polityKey: "C", government: { form: "Republic", headOfState: "President C" } };
  const batch = castInstitutionProposalVoteBatch({
    world: result.world,
    institutionId: "council",
    proposalId: "p1",
    playerCountry: "A",
    date: "2000-01-05",
    ballots: [
      { polity: "B", choice: "yes", reason: "Government supports the program." },
      { polity: "C", choice: "abstain", reason: "Coalition remains divided." },
    ],
  });
  assert.equal(batch.proposal.voting.ballots.B.choice, "yes");
  assert.match(batch.proposal.voting.ballots.B.government, /Prime B|Parliamentary republic/);
  assert.equal(batch.proposal.voting.ballots.C.choice, "abstain");
  assert.throws(() => castInstitutionProposalVoteBatch({
    world: result.world,
    institutionId: "council",
    proposalId: "p1",
    playerCountry: "A",
    ballots: [{ polity: "A", choice: "yes" }],
  }), /cannot cast the player's/i);
});

test("complete ballot batch finalizes, implements and emits one canonical institutional outcome event", () => {
  let result = open(simpleRule, {
    consequences: [{ id: "admit-d", kind: "membership", op: "join", polity: "D", status: "member" }],
  });
  result = vote(result.world, "A", "yes");
  const resolved = applyInstitutionGovernanceCommand({
    world: result.world,
    chats: [],
    events: [],
    institutionId: "council",
    playerCountry: "A",
    date: "2000-01-06",
    command: {
      type: "vote-batch",
      proposalId: "p1",
      ballots: [
        { polity: "B", choice: "yes", reason: "Supports the joint program." },
        { polity: "C", choice: "yes", reason: "Supports regional cooperation." },
      ],
      finalizeWhenComplete: true,
      implementWhenPassed: true,
    },
  });
  assert.equal(resolved.outcome.status, "passed");
  assert.equal(resolved.proposal.status, "implementation");
  assert.equal(resolved.proposal.implementation.status, "complete");
  assert.equal(resolved.world.institutions.byId.council.members.find((entry) => entry.polity === "D")?.status, "member");
  assert.equal(resolved.events.length, 1);
  assert.match(resolved.events[0].title, /Continental Council Approves Joint Program/i);
  assert.match(resolved.events[0].description, /B Republic? \(yes\)|B \(yes\)/i);
  assert.match(resolved.events[0].description, /Supports the joint program/i);
  assert.match(resolved.events[0].description, /Supports regional cooperation/i);
  assert.equal(resolved.events[0].source, "institutional-governance");
  assert.equal(resolved.events[0].agency.principalKind, "institution");
  assert.equal(resolved.events[0].agency.authority, "autonomous");
});

test("incomplete NPC batch does not close or emit an outcome event while player ballot is still missing", () => {
  const result = applyInstitutionGovernanceCommand({
    world: open().world,
    chats: [],
    events: [],
    institutionId: "council",
    playerCountry: "A",
    date: "2000-01-05",
    command: {
      type: "vote-batch",
      proposalId: "p1",
      ballots: [
        { polity: "B", choice: "yes" },
        { polity: "C", choice: "yes" },
      ],
      finalizeWhenComplete: true,
      implementWhenPassed: true,
    },
  });
  assert.equal(result.proposal.status, "voting");
  assert.equal(result.outcome, null);
  assert.deepEqual(result.events, []);
});

test("member can lodge a proposal into debate without deciding its legal outcome", () => {
  const result = lodgeInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council", proposer: "A", date: "2000-01-02",
    proposal: { id: "member-motion", title: "Member Motion", summary: "A proposal for debate." },
  });
  assert.equal(result.proposal.status, "debate");
  assert.equal(result.proposal.createdBy, "A");
  assert.ok(result.proposal.sponsorPolities.includes("A"));
  assert.equal(result.proposal.voting, null);
});

test("proposal submission opens the institution's canonical vote but fails closed with unresolved amendments", () => {
  let lodged = lodgeInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council", proposer: "A", date: "2000-01-02",
    proposal: { id: "motion", title: "Motion" },
  });
  const opened = submitInstitutionProposalForVoting({ world: lodged.world, institutionId: "council", proposalId: "motion", date: "2000-01-03" });
  assert.equal(opened.proposal.status, "voting");
  assert.equal(opened.proposal.voting.rule.type, "simple-majority");

  lodged = lodgeInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council", proposer: "A", date: "2000-01-02",
    proposal: { id: "amended", title: "Amended Motion" },
  });
  const amended = addInstitutionProposalAmendment({
    world: lodged.world, institutionId: "council", proposalId: "amended", date: "2000-01-03",
    proposer: "B", amendment: { id: "a1", text: "Change one clause" },
  });
  assert.throws(() => submitInstitutionProposalForVoting({ world: amended.world, institutionId: "council", proposalId: "amended", date: "2000-01-04" }), /unresolved amendments/);
});


test("proposal origination follows charter eligibility instead of generic room participation", () => {
  const world = makeWorld(simpleRule);
  const institution = normalizeInstitutions(world.institutions, world).byId.council;
  assert.equal(institutionCanTableProposal(institution, "A", { type: "resolution" }), true);
  assert.equal(institutionCanTableProposal(institution, "D", { type: "resolution" }), false);
  assert.throws(() => lodgeInstitutionProposal({
    world, institutionId: "council", proposer: "D", date: "2000-01-02",
    proposal: { id: "observer-motion", title: "Observer Motion", type: "resolution" },
  }), /not eligible to table/i);
});

test("proposal-specific charter eligibility can deliberately grant participant proposal rights", () => {
  const world = makeWorld(simpleRule);
  world.institutions.byId.council.members.push({ polity: "E", status: "participant", role: "member" });
  world.polityOverrides.E = { code: "E", name: "E Republic", status: "active", aliases: [] };
  world.institutions.byId.council.charter.proposalRules = {
    resolution: { type: "simple-majority", eligibleStatuses: ["member", "participant"], quorum: 0.5 },
  };
  const institution = normalizeInstitutions(world.institutions, world).byId.council;
  assert.equal(institutionCanTableProposal(institution, "E", { type: "resolution" }), true);
  const lodged = lodgeInstitutionProposal({
    world, institutionId: "council", proposer: "E", date: "2000-01-02",
    proposal: { id: "participant-motion", title: "Participant Motion", type: "resolution" },
  });
  assert.equal(lodged.proposal.createdBy, "E");
  assert.equal(lodged.proposal.status, "debate");
});

test("only a current canonical sponsor may submit an existing proposal for formal voting", () => {
  let result = lodgeInstitutionProposal({
    world: makeWorld(simpleRule), institutionId: "council", proposer: "B", date: "2000-01-01",
    proposal: { id: "sponsor-gate", title: "Sponsor Gate", type: "program", summary: "Test sponsor authority." },
  });
  assert.throws(
    () => submitInstitutionProposalForVoting({ world: result.world, institutionId: "council", proposalId: result.proposal.id, requester: "C", date: "2000-01-02" }),
    /not a sponsor/i,
  );
  const opened = submitInstitutionProposalForVoting({
    world: result.world, institutionId: "council", proposalId: result.proposal.id, requester: "B", date: "2000-01-02",
  });
  assert.equal(opened.proposal.status, "voting");
  assert.deepEqual(opened.proposal.voting.eligibleVoters, ["A", "B", "C"]);
});


test("policy commitment is complete institutional state, not reusable execution authority", () => {
  let result = createInstitutionProposal({
    world: makeWorld(simpleRule),
    institutionId: "council",
    proposal: {
      id: "policy-1",
      title: "Common Policy Position",
      type: "policy",
      consequences: [{ id: "position", kind: "policy-commitment", note: "Adopt a common policy position." }],
    },
  });
  const institutions = normalizeInstitutions(result.world.institutions, result.world);
  const proposal = institutions.byId.council.proposals["policy-1"];
  proposal.status = "passed";
  proposal.voting = { openedDate: "2000-01-02", closedDate: "2000-01-03", rule: simpleRule, eligibleVoters: ["A", "B", "C"], ballots: {}, outcome: { status: "passed" } };
  institutions.byId.council.proposals["policy-1"] = proposal;
  result.world.institutions = institutions;
  const implemented = implementInstitutionProposal({ world: result.world, institutionId: "council", proposalId: "policy-1", date: "2000-01-04" });
  assert.equal(implemented.proposal.implementation.status, "complete");
  assert.deepEqual(implemented.proposal.implementation.pending, []);
  assert.equal(implemented.proposal.implementation.applied[0]?.kind, "policy-commitment");
});

test("one-request institution batch keeps conversation and applies only explicit formal actions", async () => {
  const { applyInstitutionalChatGovernanceBatch } = await import("./institutionalGovernance.js");
  const result = applyInstitutionalChatGovernanceBatch({
    world: makeWorld(simpleRule), chats: [], events: [], institutionId: "council", playerCountry: "A", date: "2000-01-01",
    chatEvents: [{ id: "msg-1", kind: "message", time: "2000-01-01", by: "B Republic", role: "leader", code: "B", text: "I table a program." }],
    formalActions: [{ type: "institution_lodge_proposal", actorName: "B Republic", title: "Joint Program", summary: "Coordinate the program.", proposalType: "program" }],
  });
  assert.equal(result.applied.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.world.institutions.byId.council.proposals["joint-program"].createdBy, "B");
  assert.match(result.channel.messages.map((m) => m.text).join(" "), /table a program/i);
});

test("one-request institution batch refuses model authority for the human without losing NPC sibling actions", async () => {
  const { applyInstitutionalChatGovernanceBatch } = await import("./institutionalGovernance.js");
  const result = applyInstitutionalChatGovernanceBatch({
    world: makeWorld(simpleRule), chats: [], events: [], institutionId: "council", playerCountry: "A", date: "2000-01-01",
    formalActions: [
      { type: "institution_lodge_proposal", actorName: "Player Republic", title: "Fake Player Motion", summary: "Must not land.", proposalType: "resolution" },
      { type: "institution_lodge_proposal", actorName: "B Republic", title: "NPC Motion", summary: "May land.", proposalType: "resolution" },
    ],
  });
  assert.equal(result.applied.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /human-controlled/i);
  assert.ok(result.world.institutions.byId.council.proposals["npc-motion"]);
  assert.equal(result.world.institutions.byId.council.proposals["fake-player-motion"], undefined);
});
