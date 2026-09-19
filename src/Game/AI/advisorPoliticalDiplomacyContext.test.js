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
