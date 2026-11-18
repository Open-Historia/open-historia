import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ADVISOR_ACTION_COMPLETION_MAX_TOKENS,
  ADVISOR_ACTION_COMPLETION_SYSTEM,
  buildAdvisorActionCompletionQuestion,
} from "./advisorActionCompletion.js";

test("the supplemental Action check is bounded and uses only the player's latest request and visible answer", () => {
  const question = "Please draft the Spanish espionage investigation Action." + "A".repeat(9000);
  const response = "I have drafted the Action for review." + "X".repeat(23000) + "Awaiting Proceed.";
  const rendered = buildAdvisorActionCompletionQuestion({ playerRequest: question, advisorReply: response });
  assert.match(rendered, /PLAYER'S LATEST REQUEST/);
  assert.match(rendered, /ADVISOR'S COMPLETED REPLY/);
  assert.match(rendered, /Awaiting Proceed\./);
  assert.match(rendered, /Please draft the Spanish espionage/);
  assert.match(rendered, /intermediate text omitted; never infer missing details/);
  assert.ok(rendered.length <= 20000 + 250, "the supplemental input remains independent of full campaign size");
  assert.equal(ADVISOR_ACTION_COMPLETION_MAX_TOKENS, 1800);
});

test("native delivery receipts are passed as trusted bounded context to the missing-Action auditor", () => {
  const question = buildAdvisorActionCompletionQuestion({
    playerRequest: "Create the French Northern Squadron, and separately draft a naval mobilization Action.",
    advisorReply: "The squadron is ready for placement.",
    delivered: { deployments: 1, projects: 0, diplomaticDrafts: 0, institutionDrafts: 0 },
  });
  assert.match(question, /NATIVE STRUCTURED DELIVERIES/);
  assert.match(question, /1 deployment/);
  assert.match(question, /separately draft a naval mobilization Action/);
  assert.match(ADVISOR_ACTION_COMPLETION_SYSTEM, /NO_MISSING_ACTION/);
  assert.match(ADVISOR_ACTION_COMPLETION_SYSTEM, /duplicate/i);
});

test("the semantic check preserves native review boundaries and a language-neutral verdict", () => {
  assert.match(ADVISOR_ACTION_COMPLETION_SYSTEM, /NO_MISSING_ACTION/);
  assert.match(ADVISOR_ACTION_COMPLETION_SYSTEM, /UNRESOLVED_ACTION/);
  assert.match(ADVISOR_ACTION_COMPLETION_SYSTEM, /awaiting the player's Proceed\/approval/);
  assert.match(ADVISOR_ACTION_COMPLETION_SYSTEM, /Never fabricate an edit\/remove target ID/);
  assert.match(ADVISOR_ACTION_COMPLETION_SYSTEM, /Understand the natural language/);
  assert.match(ADVISOR_ACTION_COMPLETION_SYSTEM, /Action:.*alone is not evidence/);
  assert.match(ADVISOR_ACTION_COMPLETION_SYSTEM, /cannot authorize anything/);
});

test("the second AI call has no lookups, cannot access campaign-wide prompt context, and does not queue", () => {
  const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const start = source.indexOf("export async function checkAdvisorActionCompleteness(");
  const end = source.indexOf("\nexport function loadHistory(", start);
  assert.ok(start > 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /callAI\(ADVISOR_ACTION_COMPLETION_SYSTEM/);
  assert.match(body, /maxTokens: ADVISOR_ACTION_COMPLETION_MAX_TOKENS/);
  assert.match(body, /languageMode: "none"/);
  assert.match(body, /agentKind: "advisor"/);
  assert.doesNotMatch(body, /buildAdvisorSystemPrompt|mutateActionsState|applyAdvisorAction|lookups:/);
});
