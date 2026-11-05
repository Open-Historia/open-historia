import test from "node:test";
import assert from "node:assert/strict";

import { CHAT_ACTIONS_SCHEMA, GAMEPLAY_TOOLS, validateGameplayPayload } from "./gameplaySchemas.js";
import { INSTITUTION_CHAT_ACTION_KINDS } from "./institutionChatActions.js";
import { parseInstitutionLifecycleResponsesJson } from "./institutionLifecycleChatActions.js";
import { INSTITUTION_LIFECYCLE_DECISIONS } from "../../runtime/institutions.js";

const jumpWith = (ops) => ({
  clearActions: true,
  events: [{
    date: "2014-09-01",
    title: "Regional governments reorganize",
    description: "Governments open formal talks on a new regional institution.",
    impacts: { institutionLifecycleOps: ops },
  }],
  stopDate: "2014-09-30",
  summary: "Institutional diplomacy develops.",
});

test("jump schema accepts bounded AI institution lifecycle acts", () => {
  const founded = validateGameplayPayload("jumpForward", jumpWith([{
    op: "found",
    actorPolity: "Republic of Estonia",
    name: "Northern Security Compact",
    kind: "regional_bloc",
    purpose: ["Regional security"],
    geographicScope: ["Northern Europe"],
    politicalCharacter: "regional security cooperation",
    primaryThreatModel: ["Russian Federation"],
    minimumFoundingMembers: 2,
    accessionMode: "approval",
    allowObserver: true,
    withdrawalMode: "notice",
    withdrawalNoticeDays: 90,
    expulsionMode: "approval",
    dissolutionMode: "approval",
    invitees: ["Republic of Latvia"],
  }]));
  assert.equal(founded.valid, true, founded.error);

  const response = validateGameplayPayload("jumpForward", jumpWith([{
    op: "respond",
    actorPolity: "Republic of Poland",
    institutionId: "baltic-union",
    caseId: "baltic-union-invitation-poland",
    decision: "seek-observer",
    reason: "Warsaw supports cooperation but not full Baltic political integration.",
  }]));
  assert.equal(response.valid, true, response.error);
});

test("lifecycle op vocabulary is closed and demands an actor", () => {
  const badOp = validateGameplayPayload("jumpForward", jumpWith([{ op: "magically_join", actorPolity: "Republic of Poland" }]));
  assert.equal(badOp.valid, false);
  const noActor = validateGameplayPayload("jumpForward", jumpWith([{ op: "apply", institutionId: "baltic-union" }]));
  assert.equal(noActor.valid, false);
});

test("tool description explicitly preserves player sovereignty and political-fit reasoning", () => {
  const lifecycle = GAMEPLAY_TOOLS.jumpForward.schema.properties.events.items.properties.impacts.properties.institutionLifecycleOps;
  assert.match(lifecycle.description, /PWv2/i);
  assert.match(lifecycle.description, /relations/i);
  assert.match(lifecycle.description, /purpose\/scope\/obligations/i);
  assert.match(lifecycle.description, /Never make a sovereign membership decision for the human player/i);
  assert.deepEqual(lifecycle.items.properties.decision.enum, ["accept", "reject", "seek-observer", "request-terms", "delay"]);
});

// The schemas spread the canonical vocabularies, so a kind or decision added in
// one place is offered, parsed and applied everywhere, never rejected by one.
test("institution chat kinds and lifecycle decisions come from one list each", () => {
  const lifecycle = GAMEPLAY_TOOLS.jumpForward.schema.properties.events.items.properties.impacts.properties.institutionLifecycleOps;
  assert.deepEqual(lifecycle.items.properties.decision.enum, [...INSTITUTION_LIFECYCLE_DECISIONS]);
  const chatTypes = CHAT_ACTIONS_SCHEMA.properties.actions.items.properties.type.enum;
  for (const kind of INSTITUTION_CHAT_ACTION_KINDS) assert.ok(chatTypes.includes(kind), `${kind} is a chat action type`);

  const parsed = parseInstitutionLifecycleResponsesJson(INSTITUTION_LIFECYCLE_DECISIONS.map((decision) => ({
    actorName: "Republic of Poland", caseId: `case-${decision}`, decision,
  })));
  assert.deepEqual(parsed.map((action) => action.decision), [...INSTITUTION_LIFECYCLE_DECISIONS]);
  for (const decision of INSTITUTION_LIFECYCLE_DECISIONS) {
    assert.match(CHAT_ACTIONS_SCHEMA.properties.lifecycleResponsesJson.description, new RegExp(decision));
  }
});
