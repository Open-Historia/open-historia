import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeInstitutionLifecycleChatAction,
  parseInstitutionLifecycleResponsesJson,
  partitionInstitutionLifecycleChatActions,
} from "./institutionLifecycleChatActions.js";

test("normalizes only explicit lifecycle responses with exact case ids", () => {
  assert.deepEqual(normalizeInstitutionLifecycleChatAction({
    type: "institution_lifecycle_response",
    actorName: "Republic of Poland",
    lifecycleCaseId: "baltic-union-invitation-poland",
    lifecycleDecision: "seek_observer",
    reason: "Warsaw prefers partnership to full regional integration.",
  }), {
    type: "institution_lifecycle_response",
    actorName: "Republic of Poland",
    caseId: "baltic-union-invitation-poland",
    decision: "seek-observer",
    reason: "Warsaw prefers partnership to full regional integration.",
    terms: "",
  });
  assert.equal(normalizeInstitutionLifecycleChatAction({ type: "send_message", actorName: "Poland", content: "No." }), null);
  assert.equal(normalizeInstitutionLifecycleChatAction({ type: "institution_lifecycle_response", actorName: "Poland", lifecycleDecision: "accept" }), null);
  assert.equal(normalizeInstitutionLifecycleChatAction({ type: "institution_lifecycle_response", actorName: "Poland", lifecycleCaseId: "x", lifecycleDecision: "join-because-friendly" }), null);
});

test("partitions lifecycle decisions away from normal diplomatic speech", () => {
  const result = partitionInstitutionLifecycleChatActions([
    { type: "send_message", actorName: "Republic of Poland", content: "We would prefer observer status." },
    { type: "institution_lifecycle_response", actorName: "Republic of Poland", lifecycleCaseId: "case-1", lifecycleDecision: "seek-observer" },
  ]);
  assert.equal(result.lifecycle.length, 1);
  assert.equal(result.conversational.length, 1);
  assert.equal(result.lifecycle[0].decision, "seek-observer");
});


test("parses compact lifecycle response JSON without expanding the chat action union", () => {
  assert.deepEqual(parseInstitutionLifecycleResponsesJson(JSON.stringify([
    {
      actorName: "Republic of Lithuania",
      caseId: "baltic-union-founding-invitation-republic-of-lithuania-2014-08-19",
      decision: "accept",
      reason: "The union aligns with Lithuania's Baltic security priorities.",
    },
    {
      actorName: "Republic of Estonia",
      caseId: "baltic-union-founding-invitation-republic-of-estonia-2014-08-19",
      decision: "request_terms",
      terms: "Clarify the scope of economic coordination.",
    },
  ])), [
    {
      type: "institution_lifecycle_response",
      actorName: "Republic of Lithuania",
      caseId: "baltic-union-founding-invitation-republic-of-lithuania-2014-08-19",
      decision: "accept",
      reason: "The union aligns with Lithuania's Baltic security priorities.",
      terms: "",
    },
    {
      type: "institution_lifecycle_response",
      actorName: "Republic of Estonia",
      caseId: "baltic-union-founding-invitation-republic-of-estonia-2014-08-19",
      decision: "request-terms",
      reason: "",
      terms: "Clarify the scope of economic coordination.",
    },
  ]);
});


test("parses lifecycle responses that are already arrays in raw-JSON transport", () => {
  const raw = [
    { actorName: "Republic of Lithuania", caseId: "case-lt", decision: "accept" },
    { actorName: "Republic of Estonia", caseId: "case-ee", decision: "delay", reason: "Cabinet review continues." },
  ];
  assert.deepEqual(parseInstitutionLifecycleResponsesJson(raw), [
    {
      type: "institution_lifecycle_response",
      actorName: "Republic of Lithuania",
      caseId: "case-lt",
      decision: "accept",
      reason: "",
      terms: "",
    },
    {
      type: "institution_lifecycle_response",
      actorName: "Republic of Estonia",
      caseId: "case-ee",
      decision: "delay",
      reason: "Cabinet review continues.",
      terms: "",
    },
  ]);
});
