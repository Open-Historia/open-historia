import test from "node:test";
import assert from "node:assert/strict";
import { buildInstitutionDiplomacyView, buildPublicInstitutionDiplomacyView, listAllInstitutionDiplomacyViews, listInstitutionDiplomacyViews } from "./institutionalDiplomacyView.js";

const world = {
  institutions: { byId: {
    union: {
      id: "union", name: "Union", status: "active", kind: "political_union",
      members: [{ polity: "Player", status: "member", role: "member" }, { polity: "B", status: "member", role: "chair" }],
      proposals: { vote: {
        id: "vote", title: "Common Fund", status: "voting",
        voting: { rule: { type: "two-thirds", vetoPolities: ["Player"] }, eligibleVoters: ["Player", "B"], ballots: { B: { choice: "yes" } } },
      } },
    },
    suspended: { id: "suspended", name: "Suspended Council", status: "active", members: [{ polity: "Player", status: "suspended" }] },
    dissolved: { id: "dissolved", name: "Former League", status: "dissolved", members: [{ polity: "Player", status: "member" }] },
  } },
};

test("view derives player ballot state without owning legal state", () => {
  const view = buildInstitutionDiplomacyView({ world, institutionId: "union", playerCountry: "Player" });
  assert.equal(view.canParticipate, true);
  assert.equal(view.canTableProposal, true);
  assert.equal(view.openBallots.length, 1);
  assert.equal(view.openBallots[0].playerEligible, true);
  assert.equal(view.openBallots[0].playerBallot, null);
  assert.equal(view.openBallots[0].playerCanVeto, true);
  assert.equal(view.openBallots[0].ballotsRecorded, 1);
  assert.equal(view.openBallots[0].eligibleVoters, 2);
  assert.equal(view.openBallots[0].unresolvedVoters, 1);
  assert.equal(view.openBallots[0].unresolvedNpcVoters, 0);
  assert.equal(view.openBallots[0].ruleLabel, "two thirds");
});

test("institution list includes suspended historical membership but marks it read-only", () => {
  const rows = listInstitutionDiplomacyViews(world, "Player");
  assert.equal(rows.length, 3);
  const suspended = rows.find((row) => row.institution.id === "suspended");
  assert.equal(suspended.canParticipate, false);
  assert.equal(suspended.canTableProposal, false);
  const union = rows.find((row) => row.institution.id === "union");
  assert.equal(union.playerPendingBallotCount, 1);
  const dissolved = rows.find((row) => row.institution.id === "dissolved");
  assert.equal(dissolved.canParticipate, false);
});


test("proposal presentation identifies sponsor-owned debate motions without granting outcome authority", () => {
  const proposalWorld = structuredClone(world);
  proposalWorld.institutions.byId.union.proposals.motion = {
    id: "motion", title: "Motion", status: "debate", createdBy: "Player", sponsorPolities: ["Player"], amendments: [],
  };
  const view = buildInstitutionDiplomacyView({ world: proposalWorld, institutionId: "union", playerCountry: "Player" });
  const motion = view.proposals.find((entry) => entry.id === "motion");
  assert.equal(motion.playerSponsor, true);
  assert.equal(motion.playerCanSubmitForVote, true);
  assert.equal(motion.outcome, null);
});



test("amendment presentation exposes only authority-safe player actions", () => {
  const amendmentWorld = structuredClone(world);
  amendmentWorld.institutions.byId.union.proposals.motion = {
    id: "motion", title: "Motion", status: "amendment", createdBy: "Player", sponsorPolities: ["Player"],
    amendments: [
      { id: "a1", text: "Member B proposes a narrower clause.", proposedBy: "B", status: "proposed" },
      { id: "a2", text: "Player-authored change.", proposedBy: "Player", status: "proposed" },
      { id: "a3", text: "Accepted clause.", proposedBy: "B", status: "accepted", resolvedBy: "Player", resolvedDate: "2000-01-03" },
    ],
  };
  const view = buildInstitutionDiplomacyView({ world: amendmentWorld, institutionId: "union", playerCountry: "Player" });
  const motion = view.proposals.find((entry) => entry.id === "motion");
  assert.equal(motion.playerCanAmend, true);
  assert.equal(motion.unresolvedAmendments, 2);
  const foreign = motion.amendmentItems.find((entry) => entry.id === "a1");
  assert.equal(foreign.playerCanResolve, true, "proposal sponsor may accept/reject a pending amendment");
  assert.equal(foreign.playerCanWithdraw, false);
  const own = motion.amendmentItems.find((entry) => entry.id === "a2");
  assert.equal(own.playerCanWithdraw, true, "only amendment author gets withdrawal control");
  const accepted = motion.amendmentItems.find((entry) => entry.id === "a3");
  assert.equal(accepted.playerCanResolve, false);
  assert.equal(accepted.resolvedBy, "Player");
  const listRow = listInstitutionDiplomacyViews(amendmentWorld, "Player").find((row) => row.institution.id === "union");
  assert.equal(listRow.playerPendingAmendmentReviewCount, 2, "both unresolved amendments require sponsor review");
});

test("observer can read/speak when active but cannot table proposals under member-only charter", () => {
  const observerWorld = structuredClone(world);
  observerWorld.institutions.byId.observerCouncil = {
    id: "observerCouncil", name: "Observer Council", status: "active",
    charter: { votingRule: { type: "simple-majority", eligibleStatuses: ["member"] } },
    members: [{ polity: "Player", status: "observer", role: "member" }],
    proposals: {},
  };
  const view = buildInstitutionDiplomacyView({ world: observerWorld, institutionId: "observerCouncil", playerCountry: "Player" });
  assert.equal(view.canParticipate, true);
  assert.equal(view.canTableProposal, false);
});


test("presentation separates live agenda from decision history and reveals ballot reasons only after closure", () => {
  const historyWorld = structuredClone(world);
  historyWorld.institutions.byId.union.charter = {
    votingRule: { type: "simple-majority", quorum: 0.5, eligibleStatuses: ["member"] },
    proposalRules: { accession: { type: "unanimity", quorum: 1, eligibleStatuses: ["member"] } },
    note: "Council charter note.",
  };
  historyWorld.institutions.byId.union.proposals.vote.voting.ballots.B = { polity: "B", choice: "yes", reason: "Public support rationale." };
  historyWorld.institutions.byId.union.proposals.closed = {
    id: "closed", title: "Completed Decision", status: "passed", lastUpdatedDate: "2000-02-01",
    voting: {
      rule: { type: "simple-majority", quorum: 0.5 }, eligibleVoters: ["Player", "B"],
      ballots: {
        Player: { polity: "Player", choice: "yes", reason: "Player public rationale." },
        B: { polity: "B", choice: "no", reason: "B public dissent." },
      },
      outcome: { status: "passed", yes: 1, no: 1, abstain: 0, veto: 0 },
      closedDate: "2000-02-01",
    },
  };
  const view = buildInstitutionDiplomacyView({ world: historyWorld, institutionId: "union", playerCountry: "Player" });
  assert.deepEqual(view.activeProposals.map((entry) => entry.id), ["vote"]);
  assert.deepEqual(view.decisionHistory.map((entry) => entry.id), ["closed"]);
  assert.deepEqual(view.openBallots[0].closedBallots, []);
  assert.equal(view.decisionHistory[0].closedBallots.length, 2);
  assert.equal(view.decisionHistory[0].closedBallots.find((entry) => entry.polity === "B").reason, "B public dissent.");
  assert.equal(view.charterView.defaultRule.label, "simple majority");
  assert.equal(view.charterView.proposalRules[0].label, "accession");
  assert.equal(view.charterView.note, "Council charter note.");
  assert.equal(view.memberSummary.total, 2);
});

test("world institution browser includes non-member active institutions without granting participation", () => {
  const browserWorld = structuredClone(world);
  browserWorld.institutions.byId.external = {
    id: "external", name: "External Organization", status: "active", kind: "international_organization",
    members: [{ polity: "B", status: "member", role: "member" }], proposals: {},
  };
  const rows = listAllInstitutionDiplomacyViews(browserWorld, "Player");
  assert.equal(rows.some((row) => row.institution.id === "external"), true);
  const external = rows.find((row) => row.institution.id === "external");
  assert.equal(external.member, null);
  assert.equal(external.canParticipate, false);
  assert.equal(external.canTableProposal, false);
  assert.equal(rows.some((row) => row.institution.id === "dissolved"), false, "dissolved institutions stay out of the current-world browser by default");
  assert.equal(rows[0].member != null, true, "player memberships are kept first in the all-institutions browser");
});



test("public institution preview exposes identity, charter and membership without internal agenda authority", () => {
  const publicWorld = structuredClone(world);
  publicWorld.institutions.byId.union.charter = { votingRule: { type: "simple-majority", quorum: 0.5, eligibleStatuses: ["member"] } };
  const view = buildPublicInstitutionDiplomacyView({ world: publicWorld, institutionId: "union", playerCountry: "Outsider" });
  assert.ok(view);
  assert.equal(view.canParticipate, false);
  assert.equal(view.canTableProposal, false);
  assert.equal(view.proposals.length, 0);
  assert.equal(view.activeProposals.length, 0);
  assert.equal(view.openBallots.length, 0);
  assert.equal(view.decisionHistory.length, 0);
  assert.equal(view.members.length, 2);
  assert.equal(view.charterView.defaultRule.type, "simple-majority");
});
