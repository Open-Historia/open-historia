import assert from "node:assert/strict";
import test from "node:test";

import { formatAdvisorPoliticalDiplomacyContext } from "./advisorPoliticalDiplomacyContextCore.js";

const politicalContext = {
  text: [
    "ACTOR: Republic of Latvia",
    "Government: parliamentary republic / centrist coalition",
    "Goal: Preserve Baltic security",
    "Fear: Regional coercion",
    "Ambition: Deepen European influence",
    "Domestic pressure: Coalition partner demands budget restraint",
  ].join("\n"),
};

const institutionViews = [{
  institution: {
    id: "nato",
    name: "North Atlantic Treaty Organization",
  },
  member: { status: "member", role: "member" },
  canParticipate: true,
  canTableProposal: true,
  playerPendingBallotCount: 1,
  playerPendingAmendmentReviewCount: 0,
  activeProposals: [{
    id: "readiness",
    title: "Eastern Readiness Resolution",
    status: "voting",
    playerEligible: true,
    playerBallot: null,
    playerCanVeto: true,
    playerCanSubmitForVote: false,
    playerCanAmend: false,
    amendmentItems: [],
  }],
}];

test("advisor context exposes the player's own bounded PWv2 plus current institutional affordances without gaining authority", () => {
  const built = formatAdvisorPoliticalDiplomacyContext({
    playerPolity: "Republic of Latvia",
    politicalContext,
    institutionViews,
  });
  assert.match(built.politicalText, /Private Government & Political Briefing/);
  assert.match(built.politicalText, /Preserve Baltic security/);
  assert.match(built.politicalText, /Regional coercion/);
  assert.match(built.diplomacyText, /North Atlantic Treaty Organization/);
  assert.match(built.diplomacyText, /PLAYER VOTE PENDING/);
  assert.match(built.diplomacyText, /veto available/);
  assert.match(built.diplomacyText, /may NOT silently cast the player's vote/);
  assert.match(built.diplomacyText, /MAY prepare a formal institution action draft/);
  assert.match(built.diplomacyText, /may invite eligible governments/);
  assert.match(built.diplomacyText, /normally prepare the typed institution-action draft in the same reply/);
  assert.match(built.diplomacyText, /never claim the act occurred until the player confirms it/i);
  assert.deepEqual(built.institutionIds, ["nato"]);
});

test("advisor context does not invent a missing player Political Actor", () => {
  const built = formatAdvisorPoliticalDiplomacyContext({
    playerPolity: "Republic of Latvia",
    politicalContext: null,
    institutionViews: [],
  });
  assert.match(built.politicalText, /No canonical Political Actor\/PWv2 record is available/);
  assert.match(built.diplomacyText, /no tracked institutional memberships/);
});

test("advisor context cannot convert PWv2 preferences into sovereign consent", () => {
  const built = formatAdvisorPoliticalDiplomacyContext({
    playerPolity: "Republic of Latvia",
    politicalContext,
    institutionViews,
  });
  assert.match(built.text, /do not convert preferences into sovereign consent/i);
  assert.match(built.text, /Those remain explicit player\/native actions/);
});

test("Advisor receives pending institution lifecycle without gaining player authority", () => {
  const result = formatAdvisorPoliticalDiplomacyContext({
    playerPolity: "Republic of Latvia",
    politicalContext,
    institutionViews: [],
    institutionLifecycleCases: [{
      institution: { id: "baltic-union", name: "Baltic Union" },
      case: { id: "case-1", kind: "founding-invitation", status: "pending", requestedStatus: "member", reason: "Founding invitation" },
    }],
  });
  assert.match(result.text, /Pending institution lifecycle:/);
  assert.match(result.text, /Baltic Union \[baltic-union\]/);
  assert.match(result.text, /founding-invitation \/ pending/);
  assert.match(result.text, /may NOT silently cast the player's vote, accept an amendment, found\/join\/leave an institution, accept an invitation/);
  assert.deepEqual(result.institutionIds, ["baltic-union"]);
});

test("Advisor is explicitly taught that institutions are first-class structured game objects", () => {
  const built = formatAdvisorPoliticalDiplomacyContext({
    playerPolity: "Republic of Latvia",
    politicalContext,
    institutionViews,
  });
  assert.match(built.diplomacyText, /INSTITUTION CAPABILITY MANIFEST/);
  assert.match(built.diplomacyText, /first-class canonical game objects/);
  assert.match(built.diplomacyText, /name, short name, type, purpose, political character, geographic scope/);
  assert.match(built.diplomacyText, /persistent Council channels/);
  assert.match(built.diplomacyText, /NEVER tell the player that custom institutions are only simulated through treaties\/projects\/bilateral narrative/);
});

test("Advisor context labels private, Council and lifecycle threads with exact identities", () => {
  const built = formatAdvisorPoliticalDiplomacyContext({
    playerPolity: "Republic of Latvia",
    politicalContext,
    institutionViews,
    threadContexts: [
      { id: "private-russia", type: "private-bilateral", participants: ["Russian Empire"], latestSpeaker: "Russian Empire", latestText: "Private note" },
      { id: "institution-channel-nato", type: "institution-council", institutionId: "nato", participants: ["United States", "Republic of Latvia"], latestText: "Council note" },
      { id: "institution-invite-nato-latvia", type: "institution-lifecycle", institutionId: "nato", lifecycleCaseIds: ["case-1"], participants: ["Republic of Latvia"], latestText: "Accession note" },
    ],
  });
  assert.match(built.diplomacyText, /PRIVATE BILATERAL \[thread=private-russia\]/);
  assert.match(built.diplomacyText, /INSTITUTION COUNCIL \[institution=nato \| thread=institution-channel-nato\]/);
  assert.match(built.diplomacyText, /INSTITUTION LIFECYCLE \[institution=nato \| cases=case-1 \| thread=institution-invite-nato-latvia\]/);
  assert.match(built.diplomacyText, /never rely on whichever chat happened to be opened most recently/i);
});
