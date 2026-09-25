import test from "node:test";
import assert from "node:assert/strict";
import {
  applyInstitutionLifecycleCommandCore,
  buildInstitutionLifecycleDecisionContext,
  ensureInstitutionLifecycleNegotiationChatCore,
  institutionLifecycleConversationState,
  institutionPortfolioForPolity,
} from "./institutionLifecycleCore.js";

const baseWorld = () => ({
  ownerCodes: ["Republic of Latvia", "Republic of Estonia", "Republic of Lithuania", "Republic of Poland", "Russian Federation"],
  polityOverrides: {
    "Republic of Latvia": { name: "Republic of Latvia" },
    "Republic of Estonia": { name: "Republic of Estonia" },
    "Republic of Lithuania": { name: "Republic of Lithuania" },
    "Republic of Poland": { name: "Republic of Poland" },
    "Russian Federation": { name: "Russian Federation" },
  },
  relations: [
    { a: "Republic of Latvia", b: "Republic of Estonia", status: "friendly", score: 72 },
    { a: "Republic of Latvia", b: "Republic of Poland", status: "friendly", score: 63 },
    { a: "Russian Federation", b: "Republic of Latvia", status: "hostile", score: -71 },
  ],
});

const foundBaltic = (invitees = ["Republic of Estonia"]) => applyInstitutionLifecycleCommandCore({
  world: baseWorld(), chats: [], events: [], playerCountry: "Republic of Latvia", date: "2014-08-20",
  command: {
    type: "found",
    name: "Baltic Union",
    shortName: "BU",
    kind: "regional_bloc",
    purpose: ["Regional defense", "Economic coordination", "Baltic political integration"],
    politicalCharacter: "Baltic regional integration",
    geographicScope: ["Baltic States"],
    primaryThreatModel: ["Russian Federation"],
    votingRule: "simple-majority",
    minimumFoundingMembers: 2,
    invitees,
  },
});

test("founding creates a provisional canonical institution and invitations, not foreign membership", () => {
  const result = foundBaltic(["Republic of Estonia", "Republic of Poland"]);
  assert.equal(result.institution.status, "provisional");
  assert.deepEqual(result.institution.members.map((entry) => entry.polity), ["Republic of Latvia"]);
  assert.equal(Object.values(result.institution.lifecycleCases).length, 2);
  assert.equal(result.createdChat.lifecycleInstitutionId, result.institution.id);
  assert.equal(result.createdChat.lifecycleCaseIds.length, 2);
  assert.match(result.events.at(-1).title, /Baltic Union Is Founded/);
});



test("founding supports institution names written wholly in non-Latin scripts", () => {
  const result = applyInstitutionLifecycleCommandCore({
    world: baseWorld(), chats: [], events: [], playerCountry: "Republic of Latvia", date: "2014-08-20",
    command: {
      type: "found",
      name: "Балтийский союз",
      shortName: "БС",
      kind: "regional_bloc",
      minimumFoundingMembers: 1,
      invitees: [],
    },
  });
  assert.match(result.institution.id, /^u-[a-z0-9]+$/);
  assert.equal(result.institution.name, "Балтийский союз");
  assert.equal(result.institution.status, "active");
});

test("pending founding invitations can recreate a missing negotiation thread from canonical lifecycle state", () => {
  const founded = foundBaltic(["Republic of Estonia", "Republic of Lithuania"]);
  const reopened = ensureInstitutionLifecycleNegotiationChatCore({
    world: founded.world,
    chats: [],
    institutionId: founded.institution.id,
    caseIds: founded.caseIds,
    playerCountry: "Republic of Latvia",
    date: "2014-08-22",
  });
  assert.ok(reopened.channel);
  assert.equal(reopened.channel.status, "open");
  assert.deepEqual(new Set(reopened.channel.lifecycleCaseIds), new Set(founded.caseIds));
  assert.deepEqual(new Set(reopened.channel.countries.map((entry) => entry.name)), new Set(["Republic of Estonia", "Republic of Lithuania"]));
  assert.match(reopened.channel.title, /Baltic Union founding invitation/i);
});

test("a closed lifecycle negotiation is reopened without duplicating its history", () => {
  const founded = foundBaltic(["Republic of Estonia"]);
  const original = {
    ...founded.createdChat,
    status: "closed",
    messages: [...founded.createdChat.messages, { role: "leader", speaker: "Republic of Estonia", text: "Tallinn requests time to consider.", time: "2014-08-21" }],
  };
  const reopened = ensureInstitutionLifecycleNegotiationChatCore({
    world: founded.world,
    chats: [original],
    institutionId: founded.institution.id,
    caseIds: founded.caseIds,
    playerCountry: "Republic of Latvia",
    date: "2014-08-22",
  });
  assert.equal(reopened.channel.id, original.id);
  assert.equal(reopened.channel.status, "open");
  assert.equal(reopened.channel.messages.length, 2);
  assert.equal(reopened.reopened, true);
  assert.equal(reopened.chats.length, 1);
});

test("accession decision context carries institution identity, relations and threat model without hardcoding a country result", () => {
  const result = foundBaltic(["Russian Federation", "Republic of Poland"]);
  const context = buildInstitutionLifecycleDecisionContext(result.world, {
    institutionId: result.institution.id,
    caseIds: result.caseIds,
    actorPolities: ["Russian Federation", "Republic of Poland"],
    playerCountry: "Republic of Latvia",
  });
  assert.match(context.text, /Purpose: Regional defense; Economic coordination; Baltic political integration/);
  assert.match(context.text, /Geographic scope: Baltic States/);
  assert.match(context.text, /Primary threat\/adversary model: Russian Federation/);
  assert.match(context.text, /Russia|Russian Federation/);
  assert.match(context.text, /Positive relations alone never imply/);
  assert.match(context.text, /regional identity can make observer\/partnership status more plausible/i);
  assert.match(context.text, /explicitly named in the institution's primary threat model/);
});

test("an invited government can reject without mutating membership", () => {
  const founded = foundBaltic(["Republic of Estonia"]);
  const caseId = founded.caseIds[0];
  const result = applyInstitutionLifecycleCommandCore({
    world: founded.world, chats: founded.chats, events: founded.events, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId, actorPolity: "Republic of Estonia", decision: "reject", reason: "Tallinn prefers cooperation without political union." },
  });
  assert.equal(result.institution.members.some((entry) => entry.polity === "Republic of Estonia"), false);
  assert.equal(result.institution.lifecycleCases[caseId].status, "rejected");
  assert.equal(result.action, "rejected");
});

test("accepted founding invitation activates the institution only after the founding threshold", () => {
  const founded = foundBaltic(["Republic of Estonia"]);
  const result = applyInstitutionLifecycleCommandCore({
    world: founded.world, chats: founded.chats, events: founded.events, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId: founded.caseIds[0], actorPolity: "Republic of Estonia", decision: "accept", reason: "Strategic and regional fit is strong." },
  });
  assert.equal(result.institution.status, "active");
  assert.equal(result.institution.members.some((entry) => entry.polity === "Republic of Estonia"), true);
  assert.equal(result.institution.lifecycleCases[founded.caseIds[0]].status, "accepted");
  assert.ok(result.institution.membershipHistory.some((entry) => entry.action === "joined" && entry.polity === "Republic of Estonia"));
});

test("accepting an invitation to an active institution starts charter approval rather than auto-joining", () => {
  const founded = foundBaltic(["Republic of Estonia"]);
  const active = applyInstitutionLifecycleCommandCore({
    world: founded.world, chats: founded.chats, events: founded.events, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId: founded.caseIds[0], actorPolity: "Republic of Estonia", decision: "accept" },
  });
  const invited = applyInstitutionLifecycleCommandCore({
    world: active.world, chats: active.chats, events: active.events, playerCountry: "Republic of Latvia", date: "2014-09-01",
    command: { type: "invite", institutionId: active.institution.id, initiatedBy: "Republic of Latvia", polity: "Republic of Poland", requestedStatus: "member" },
  });
  const responded = applyInstitutionLifecycleCommandCore({
    world: invited.world, chats: invited.chats, events: invited.events, playerCountry: "Republic of Latvia", date: "2014-09-02",
    command: { type: "respond", institutionId: active.institution.id, caseId: invited.lifecycleCase.id, actorPolity: "Republic of Poland", decision: "accept", reason: "Warsaw is willing to accede." },
  });
  assert.equal(responded.institution.members.some((entry) => entry.polity === "Republic of Poland"), false);
  assert.equal(responded.lifecycleCase.status, "pending-approval");
  assert.equal(responded.proposal.status, "voting");
  assert.equal(responded.proposal.consequences[0].op, "join");
  const negotiationState = institutionLifecycleConversationState(responded.world, { institutionId: active.institution.id, caseIds: [invited.lifecycleCase.id] });
  assert.equal(negotiationState.responseComplete, true);
  assert.equal(negotiationState.awaitingApprovalCases.length, 1);
});

test("player accession application is canonical business and cannot be filed for another sovereign polity", () => {
  const founded = foundBaltic([]);
  const institutionId = founded.institution.id;
  const externalWorld = {
    ...founded.world,
    institutions: founded.world.institutions,
  };
  // Remove the founder membership to turn this object into a non-member test target.
  externalWorld.institutions.byId[institutionId] = { ...externalWorld.institutions.byId[institutionId], members: [{ polity: "Republic of Estonia", status: "member", role: "leader", sinceDate: "2014-08-20" }], leaders: ["Republic of Estonia"] };
  const application = applyInstitutionLifecycleCommandCore({
    world: externalWorld, playerCountry: "Republic of Latvia", date: "2014-09-05",
    command: { type: "apply", institutionId, requestedStatus: "member", reason: "Riga seeks accession." },
  });
  assert.equal(application.lifecycleCase.status, "pending-approval");
  assert.equal(application.proposal.status, "voting");
  assert.throws(() => applyInstitutionLifecycleCommandCore({
    world: externalWorld, playerCountry: "Republic of Latvia", date: "2014-09-05",
    command: { type: "apply", institutionId, polity: "Russian Federation", requestedStatus: "member" },
  }), /cannot submit an accession application for another sovereign government/i);
});

test("unilateral withdrawal changes canonical membership and remains in portfolio history", () => {
  const founded = foundBaltic(["Republic of Estonia"]);
  const active = applyInstitutionLifecycleCommandCore({
    world: founded.world, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId: founded.caseIds[0], actorPolity: "Republic of Estonia", decision: "accept" },
  });
  const withdrawn = applyInstitutionLifecycleCommandCore({
    world: active.world, playerCountry: "Republic of Latvia", date: "2015-01-01",
    command: { type: "withdraw", institutionId: active.institution.id, polity: "Republic of Latvia", authority: "player", reason: "Government changes course." },
  });
  assert.equal(withdrawn.institution.members.some((entry) => entry.polity === "Republic of Latvia"), false);
  const portfolio = institutionPortfolioForPolity(withdrawn.world, "Republic of Latvia");
  assert.equal(portfolio.length, 1);
  assert.ok(portfolio[0].history.some((entry) => ["withdrawn", "left"].includes(entry.action)));
});

test("dissolution and disciplinary actions are proposals, not button-authorized mutations", () => {
  const founded = foundBaltic(["Republic of Estonia"]);
  const active = applyInstitutionLifecycleCommandCore({
    world: founded.world, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId: founded.caseIds[0], actorPolity: "Republic of Estonia", decision: "accept" },
  });
  const expel = applyInstitutionLifecycleCommandCore({
    world: active.world, playerCountry: "Republic of Latvia", date: "2015-01-02",
    command: { type: "expel", institutionId: active.institution.id, polity: "Republic of Estonia", initiatedBy: "Republic of Latvia", reason: "Formal disciplinary motion." },
  });
  assert.equal(expel.institution.members.some((entry) => entry.polity === "Republic of Estonia"), true);
  assert.equal(expel.proposal.status, "voting");
  const dissolve = applyInstitutionLifecycleCommandCore({
    world: expel.world, playerCountry: "Republic of Latvia", date: "2015-01-03",
    command: { type: "dissolve", institutionId: active.institution.id, initiatedBy: "Republic of Latvia" },
  });
  assert.equal(dissolve.institution.status, "active");
  assert.equal(dissolve.proposal.consequences[0].kind, "institution-status");
});

test("event-path lifecycle can invite the player but cannot invent the player's sovereign response", async () => {
  const founded = applyInstitutionLifecycleCommandCore({
    world: baseWorld(), playerCountry: "Republic of Latvia", date: "2014-08-20",
    command: { type: "found", founder: "Republic of Estonia", authority: "npc", name: "Northern Security Compact", minimumFoundingMembers: 1 },
  });
  const { applyInstitutionLifecycleImpactBatchCore } = await import("./institutionLifecycleCore.js");
  const invited = applyInstitutionLifecycleImpactBatchCore({
    world: founded.world,
    playerCountry: "Republic of Latvia",
    date: "2014-08-21",
    ops: [{ op: "invite", actorPolity: "Republic of Estonia", institutionId: founded.institution.id, targetPolity: "Republic of Latvia", requestedStatus: "member" }],
  });
  assert.equal(invited.rejected.length, 0);
  assert.equal(invited.applied.length, 1);
  assert.equal(invited.world.institutions.byId[founded.institution.id].members.some((entry) => entry.polity === "Republic of Latvia"), false);
  const playerCase = Object.values(invited.world.institutions.byId[founded.institution.id].lifecycleCases)
    .find((entry) => entry.polity === "Republic of Latvia");
  assert.ok(playerCase);
  const refused = applyInstitutionLifecycleImpactBatchCore({
    world: invited.world,
    playerCountry: "Republic of Latvia",
    date: "2014-08-22",
    ops: [{ op: "respond", actorPolity: "Republic of Latvia", institutionId: founded.institution.id, caseId: playerCase.id, decision: "accept" }],
  });
  assert.equal(refused.applied.length, 0);
  assert.match(refused.rejected[0].reason, /player|human/i);
});

test("GM/admin lifecycle authority may enact an explicitly approved player lifecycle act", async () => {
  const founded = applyInstitutionLifecycleCommandCore({
    world: baseWorld(), playerCountry: "Republic of Latvia", date: "2014-08-20",
    command: { type: "found", founder: "Republic of Estonia", authority: "npc", name: "Northern Security Compact", minimumFoundingMembers: 1 },
  });
  const { applyInstitutionLifecycleImpactBatchCore } = await import("./institutionLifecycleCore.js");
  const applied = applyInstitutionLifecycleImpactBatchCore({
    world: founded.world,
    playerCountry: "Republic of Latvia",
    date: "2014-08-22",
    authority: "admin",
    ops: [{ op: "apply", actorPolity: "Republic of Latvia", institutionId: founded.institution.id, requestedStatus: "observer", reason: "GM-approved correction" }],
  });
  assert.equal(applied.rejected.length, 0);
  assert.equal(applied.applied.length, 1);
  const lifecycleCase = applied.applied[0].lifecycleCase;
  assert.equal(lifecycleCase.polity, "Republic of Latvia");
  assert.equal(lifecycleCase.requestedStatus, "observer");
});

test("foreign portfolio projections hide pending lifecycle negotiations from unrelated viewers", () => {
  const founded = foundBaltic(["Republic of Poland"]);
  const publicRows = institutionPortfolioForPolity(founded.world, "Republic of Poland", { viewerPolity: "Russian Federation" });
  assert.equal(publicRows.length, 0, "an unrelated viewer should not discover a private pending invitation");
  const ownRows = institutionPortfolioForPolity(founded.world, "Republic of Poland", { viewerPolity: "Republic of Poland" });
  assert.equal(ownRows.length, 1);
  assert.equal(ownRows[0].cases.length, 1);
});

test("player accession application opens a formal accession hearing without granting membership", () => {
  const founded = foundBaltic([]);
  const institutionId = founded.institution.id;
  const world = structuredClone(founded.world);
  world.institutions.byId[institutionId] = {
    ...world.institutions.byId[institutionId],
    status: "active",
    members: [
      { polity: "Republic of Estonia", status: "member", role: "leader", sinceDate: "2014-08-20" },
      { polity: "Republic of Lithuania", status: "member", role: "member", sinceDate: "2014-08-20" },
    ],
    leaders: ["Republic of Estonia"],
  };
  const result = applyInstitutionLifecycleCommandCore({
    world, chats: [], events: [], playerCountry: "Republic of Latvia", date: "2014-09-05",
    command: { type: "apply", institutionId, requestedStatus: "member", reason: "Riga seeks accession." },
  });
  assert.equal(result.institution.members.some((entry) => entry.polity === "Republic of Latvia"), false);
  assert.equal(result.lifecycleCase.status, "pending-approval");
  assert.equal(result.proposal.status, "voting");
  assert.ok(result.createdChat, "the player applicant should receive a visible accession hearing");
  assert.equal(result.createdChat.institutionId, institutionId);
  assert.equal(result.createdChat.lifecycleInstitutionId, institutionId);
  assert.ok(result.createdChat.lifecycleCaseIds.includes(result.lifecycleCase.id));
  const participants = result.createdChat.countries.map((entry) => entry.name);
  assert.ok(participants.includes("Republic of Estonia"));
  assert.ok(participants.includes("Republic of Lithuania"));
  assert.ok(participants.includes("Republic of Latvia"));
  assert.match(result.createdChat.title, /accession hearing/i);
});

test("accepted active-institution invitation promotes its negotiation into a formal accession hearing", () => {
  const founded = foundBaltic(["Republic of Estonia"]);
  const active = applyInstitutionLifecycleCommandCore({
    world: founded.world, chats: founded.chats, events: founded.events, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId: founded.caseIds[0], actorPolity: "Republic of Estonia", decision: "accept" },
  });
  const invited = applyInstitutionLifecycleCommandCore({
    world: active.world, chats: active.chats, events: active.events, playerCountry: "Republic of Latvia", date: "2014-09-01",
    command: { type: "invite", institutionId: active.institution.id, initiatedBy: "Republic of Latvia", polity: "Republic of Poland", requestedStatus: "member" },
  });
  const invitationChatId = invited.createdChat.id;
  const result = applyInstitutionLifecycleCommandCore({
    world: invited.world, chats: invited.chats, events: invited.events, playerCountry: "Republic of Latvia", date: "2014-09-02",
    command: { type: "respond", institutionId: active.institution.id, caseId: invited.lifecycleCase.id, actorPolity: "Republic of Poland", decision: "accept", reason: "Warsaw accepts subject to charter approval." },
  });
  assert.equal(result.lifecycleCase.status, "pending-approval");
  assert.ok(result.proposal);
  assert.ok(result.createdChat);
  assert.equal(result.createdChat.id, invitationChatId, "the existing invitation thread should be promoted rather than duplicated");
  assert.equal(result.createdChat.institutionId, active.institution.id);
  assert.equal(result.createdChat.lifecycleInstitutionId, active.institution.id);
  assert.ok(result.createdChat.lifecycleCaseIds.includes(invited.lifecycleCase.id));
  assert.match(result.createdChat.title, /accession hearing/i);
});

test("founding charter persists configurable accession, withdrawal, expulsion and dissolution rules", () => {
  const founded = applyInstitutionLifecycleCommandCore({
    world: baseWorld(), playerCountry: "Republic of Latvia", date: "2014-08-20",
    command: {
      type: "found", name: "Baltic Compact", minimumFoundingMembers: 1,
      accessionMode: "direct", allowObserver: false,
      withdrawalMode: "notice", withdrawalNoticeDays: 180,
      expulsionMode: "not-permitted", dissolutionMode: "not-permitted",
    },
  });
  const lifecycle = founded.institution.charter.lifecycle;
  assert.equal(lifecycle.accession.mode, "direct");
  assert.deepEqual(lifecycle.accession.allowedStatuses, ["member"]);
  assert.equal(lifecycle.withdrawal.mode, "notice");
  assert.equal(lifecycle.withdrawal.noticeDays, 180);
  assert.equal(lifecycle.expulsion.mode, "not-permitted");
  assert.equal(lifecycle.dissolution.mode, "not-permitted");

  const notice = applyInstitutionLifecycleCommandCore({
    world: founded.world, playerCountry: "Republic of Latvia", date: "2015-01-01",
    command: { type: "withdraw", institutionId: founded.institution.id, polity: "Republic of Latvia", authority: "player" },
  });
  assert.equal(notice.action, "withdrawal-notice");
  assert.equal(notice.lifecycleCase.effectiveDate, "2015-06-30");
  assert.throws(() => applyInstitutionLifecycleCommandCore({
    world: founded.world, playerCountry: "Republic of Latvia", date: "2015-01-02",
    command: { type: "dissolve", institutionId: founded.institution.id, initiatedBy: "Republic of Latvia" },
  }), /does not permit dissolution/i);
});

test("direct-accession charter admits an applicant natively without inventing an institution vote", () => {
  const founded = applyInstitutionLifecycleCommandCore({
    world: baseWorld(), playerCountry: "Republic of Latvia", date: "2014-08-20",
    command: { type: "found", name: "Open Regional Forum", minimumFoundingMembers: 1, accessionMode: "direct" },
  });
  const world = structuredClone(founded.world);
  world.institutions.byId[founded.institution.id] = {
    ...world.institutions.byId[founded.institution.id],
    members: [{ polity: "Republic of Estonia", status: "member", role: "leader", sinceDate: "2014-08-20" }],
    leaders: ["Republic of Estonia"],
  };
  const applied = applyInstitutionLifecycleCommandCore({
    world, playerCountry: "Republic of Latvia", date: "2014-09-01",
    command: { type: "apply", institutionId: founded.institution.id, requestedStatus: "member", reason: "Riga opts into the open charter." },
  });
  assert.equal(applied.action, "joined");
  assert.equal(Boolean(applied.proposal), false);
  assert.equal(applied.createdChat, null);
  assert.equal(applied.institution.members.some((entry) => entry.polity === "Republic of Latvia"), true);
  assert.equal(applied.lifecycleCase.status, "accepted");
});

test("notice withdrawal remains membership until the canonical effective date and then advances natively", async () => {
  const founded = applyInstitutionLifecycleCommandCore({
    world: baseWorld(), playerCountry: "Republic of Latvia", date: "2014-08-20",
    command: { type: "found", name: "Notice Union", minimumFoundingMembers: 1, withdrawalMode: "notice", withdrawalNoticeDays: 30 },
  });
  const notice = applyInstitutionLifecycleCommandCore({
    world: founded.world, playerCountry: "Republic of Latvia", date: "2015-01-01",
    command: { type: "withdraw", institutionId: founded.institution.id, polity: "Republic of Latvia", authority: "player" },
  });
  assert.equal(notice.institution.members.some((entry) => entry.polity === "Republic of Latvia"), true);
  const { advanceInstitutionLifecycleCore } = await import("./institutionLifecycleCore.js");
  const early = advanceInstitutionLifecycleCore({ world: notice.world, date: "2015-01-15", playerCountry: "Republic of Latvia" });
  assert.equal(early.world.institutions.byId[founded.institution.id].members.some((entry) => entry.polity === "Republic of Latvia"), true);
  const due = advanceInstitutionLifecycleCore({ world: early.world, date: "2015-01-31", playerCountry: "Republic of Latvia" });
  assert.equal(due.world.institutions.byId[founded.institution.id].members.some((entry) => entry.polity === "Republic of Latvia"), false);
  assert.equal(due.applied.length, 1);
});


test("resolved invitees are removed from diplomatic response context while delayed invitees remain", () => {
  const founded = foundBaltic(["Republic of Estonia", "Republic of Lithuania"]);
  const byPolity = Object.fromEntries(Object.values(founded.institution.lifecycleCases).map((entry) => [entry.polity, entry.id]));
  const estoniaAccepted = applyInstitutionLifecycleCommandCore({
    world: founded.world, chats: founded.chats, events: founded.events, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId: byPolity["Republic of Estonia"], actorPolity: "Republic of Estonia", decision: "accept" },
  });
  const lithuaniaDelayed = applyInstitutionLifecycleCommandCore({
    world: estoniaAccepted.world, chats: estoniaAccepted.chats, events: estoniaAccepted.events, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId: byPolity["Republic of Lithuania"], actorPolity: "Republic of Lithuania", decision: "delay" },
  });
  const context = buildInstitutionLifecycleDecisionContext(lithuaniaDelayed.world, {
    institutionId: founded.institution.id,
    caseIds: founded.caseIds,
    actorPolities: ["Republic of Estonia", "Republic of Lithuania"],
    playerCountry: "Republic of Latvia",
  });
  assert.doesNotMatch(context.text, new RegExp(`case ${byPolity["Republic of Estonia"]}`));
  assert.match(context.text, new RegExp(`case ${byPolity["Republic of Lithuania"]}`));
  const state = institutionLifecycleConversationState(lithuaniaDelayed.world, { institutionId: founded.institution.id, caseIds: founded.caseIds });
  assert.equal(state.responseCases.length, 1);
  assert.equal(state.responseCases[0].polity, "Republic of Lithuania");
  assert.equal(state.responseComplete, false);
});

test("a founding negotiation is response-complete after every invitee accepts or rejects", () => {
  const founded = applyInstitutionLifecycleCommandCore({
    world: baseWorld(), chats: [], events: [], playerCountry: "Republic of Latvia", date: "2014-08-20",
    command: {
      type: "found", name: "Baltic Union", shortName: "BU", kind: "regional_bloc",
      purpose: ["Regional defense"], politicalCharacter: "Baltic regional integration", geographicScope: ["Baltic States"],
      minimumFoundingMembers: 3, invitees: ["Republic of Estonia", "Republic of Lithuania"],
    },
  });
  const byPolity = Object.fromEntries(Object.values(founded.institution.lifecycleCases).map((entry) => [entry.polity, entry.id]));
  const estoniaAccepted = applyInstitutionLifecycleCommandCore({
    world: founded.world, chats: founded.chats, events: founded.events, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId: byPolity["Republic of Estonia"], actorPolity: "Republic of Estonia", decision: "accept" },
  });
  const lithuaniaAccepted = applyInstitutionLifecycleCommandCore({
    world: estoniaAccepted.world, chats: estoniaAccepted.chats, events: estoniaAccepted.events, playerCountry: "Republic of Latvia", date: "2014-08-21",
    command: { type: "respond", institutionId: founded.institution.id, caseId: byPolity["Republic of Lithuania"], actorPolity: "Republic of Lithuania", decision: "accept" },
  });
  const state = institutionLifecycleConversationState(lithuaniaAccepted.world, { institutionId: founded.institution.id, caseIds: founded.caseIds });
  assert.equal(state.cases.length, 2);
  assert.equal(state.responseCases.length, 0);
  assert.equal(state.resolvedCases.length, 2);
  assert.equal(state.responseComplete, true);
  const context = buildInstitutionLifecycleDecisionContext(lithuaniaAccepted.world, {
    institutionId: founded.institution.id, caseIds: founded.caseIds, actorPolities: ["Republic of Estonia", "Republic of Lithuania"], playerCountry: "Republic of Latvia",
  });
  assert.equal(context.text, "");
});
