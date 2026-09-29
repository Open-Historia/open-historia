import assert from "node:assert/strict";
import test from "node:test";

import { ADVISOR_DIPLOMACY_OPTIONS_MAX_CHARS, formatAdvisorPoliticalDiplomacyContext } from "./advisorPoliticalDiplomacyContextCore.js";

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

// A busy campaign: a dozen chatty threads and several institutions with long
// charters. The brief used to be sliced to its cap after the lists, which cut
// the authority rules off (P06#1).
const bigInstitution = (n, over = {}) => ({
  institution: {
    id: `inst-${n}`,
    name: `Institution Number ${n}`,
    kind: "alliance",
    members: Array.from({ length: 16 }, (_, m) => ({ polity: `Member State ${m}` })),
    charter: { note: "Obligations ".repeat(40), decisionRule: "consensus", lifecycle: { purpose: ["Security", "Trade", "Culture"] } },
  },
  member: { status: "member" },
  canParticipate: true,
  playerPendingBallotCount: 0,
  activeProposals: [],
  ...over,
});
const chattyThread = (n) => ({
  id: `thread-${n}`, type: "private-bilateral", participants: [`Country ${n}`],
  latestSpeaker: `Country ${n}`, latestText: "A long message about the state of affairs. ".repeat(7),
});

test("the authority rules survive a busy campaign whole, and rows are cut whole", () => {
  const built = formatAdvisorPoliticalDiplomacyContext({
    playerPolity: "Republic of Latvia",
    politicalContext,
    institutionViews: Array.from({ length: 4 }, (_, n) => bigInstitution(n)),
    threadContexts: Array.from({ length: 12 }, (_, n) => chattyThread(n)),
  });
  const text = built.diplomacyText;
  assert.match(text, /Advisor authority boundary:/);
  assert.match(text, /may NOT silently cast the player's vote/);
  assert.match(text, /identify any pending player decision clearly\./);
  assert.ok(text.length <= ADVISOR_DIPLOMACY_OPTIONS_MAX_CHARS + 200, `brief grew to ${text.length}`);
  // Every thread either appears whole, as its short line, or is counted.
  const shown = (text.match(/^- PRIVATE BILATERAL \[thread=thread-\d+\]/gm) || []).length;
  const counted = Number((/- (\d+) more diplomatic threads? omitted/.exec(text) || [0, 0])[1]);
  assert.equal(shown + counted, 12);
  assert.ok((text.match(/^ {2}latest /gm) || []).length < 12, "a dozen chatty threads do not all fit in full");
  assert.ok((text.match(/^ {2}members: /gm) || []).length < 4, "nor do four long charters");
  assert.match(text, /^- Institution Number 3 \[inst-3\] — member$/m, "an institution cut short keeps its short line");
  // Nothing ends mid-row: the last line is a whole line of the brief.
  assert.match(text.split("\n").at(-1), /omitted from this brief\.$|^ {2}latest|^- /);
});

// P06#5: past twelve institutions the brief said "use institution lookups",
// which the advisor does not have.
test("institutions past the twelfth are named on a short line each, with a pending vote", () => {
  const built = formatAdvisorPoliticalDiplomacyContext({
    playerPolity: "Republic of Latvia",
    politicalContext,
    institutionViews: Array.from({ length: 14 }, (_, n) => ({
      institution: { id: `i${n}`, name: `Body ${n}` },
      member: { status: "member" },
      playerPendingBallotCount: n === 13 ? 1 : 0,
      activeProposals: [],
    })),
  });
  assert.doesNotMatch(built.diplomacyText, /lookups/);
  assert.match(built.diplomacyText, /^- Body 12 \[i12\] — member$/m);
  assert.match(built.diplomacyText, /^- Body 13 \[i13\] — member \| vote pending$/m);
});

test("lifecycle cases and threads the caller left out are counted", () => {
  const built = formatAdvisorPoliticalDiplomacyContext({
    playerPolity: "Republic of Latvia",
    politicalContext,
    institutionLifecycleCases: [{
      institution: { id: "baltic-union", name: "Baltic Union" },
      case: { id: "case-1", kind: "founding-invitation", status: "pending" },
    }],
    institutionLifecycleCaseCount: 3,
    threadContexts: [chattyThread(1)],
    threadCount: 30,
  });
  assert.match(built.diplomacyText, /Baltic Union \[baltic-union\] — founding-invitation \/ pending/);
  assert.match(built.diplomacyText, /- 2 more pending lifecycle cases omitted from this brief\./);
  assert.match(built.diplomacyText, /- 29 more diplomatic threads omitted from this brief\./);
});
