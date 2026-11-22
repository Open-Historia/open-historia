// Run: node --test src/Game/AI/actionHistoryText.test.js
//
// The jump templates say "Orders from earlier rounds, already carried out" and
// the advisor's "excluding the current round" over PLAYER_EVERY_ACTION_NOT_PREVIOUS,
// which rendered every action, this round's live orders included. A skip could
// read a planned order as already done, or carry it out twice (S01#10).
import test from "node:test";
import assert from "node:assert/strict";

import defaultPrompts from "./defaultPrompts.json" with { type: "json" };
import { buildActionHistoryText, buildPromptContext, renderTemplate, resolveHelperValues } from "./promptContext.js";

const actions = [
  { id: "a1", title: "Annex the border strip", text: "Annex the border strip", status: "resolved" },
  { id: "a2", title: "Open talks with Poland", text: "Open talks with Poland", kind: "chat", status: "resolved" },
  { id: "a3", title: "Raise the reserves", text: "Raise the reserves", status: "planned" },
];

test("the resolved history leaves this round's orders out", () => {
  const text = buildActionHistoryText(actions, { includeResolved: true, includePlanned: false });
  assert.match(text, /Annex the border strip \[resolved\]/);
  assert.match(text, /Open talks with Poland \[resolved\]/);
  assert.doesNotMatch(text, /Raise the reserves/);
});

test("the full history still carries every order", () => {
  assert.match(buildActionHistoryText(actions, { includeResolved: true }), /Raise the reserves/);
});

test("with nothing resolved yet, it says so", () => {
  assert.equal(
    buildActionHistoryText([actions[2]], { includeResolved: true, includePlanned: false }),
    "No actions from earlier rounds have been resolved yet.",
  );
});

test("the 'not previous' helper renders the resolved history, and 'this round' the planned orders", async () => {
  const variables = await buildPromptContext({ actions, game: { gameDate: "2016-01-01" }, world: {}, events: [], chats: [], advisor: [] }, { requiredKeys: ["resolvedActions", "plannedActions"] });
  const helpers = resolveHelperValues(defaultPrompts.helpers, variables, {
    includeKeys: ["PLAYER_EVERY_ACTION_NOT_PREVIOUS", "PLAYER_ACTIONS_THIS_ROUND"],
  });
  assert.doesNotMatch(helpers.PLAYER_EVERY_ACTION_NOT_PREVIOUS, /Raise the reserves/);
  assert.match(helpers.PLAYER_EVERY_ACTION_NOT_PREVIOUS, /Annex the border strip/);
  assert.match(helpers.PLAYER_ACTIONS_THIS_ROUND, /Raise the reserves/);

  const line = renderTemplate("Orders from earlier rounds, already carried out: ${PLAYER_EVERY_ACTION_NOT_PREVIOUS}", helpers);
  assert.doesNotMatch(line, /Raise the reserves/);
});

test("a skip's orders this round carry their ids, which the focus names them by; other tasks' do not", async () => {
  assert.match(buildActionHistoryText(actions, { ids: true }), /^- \[a3\] \(action\) Raise the reserves: Raise the reserves$/m);
  assert.doesNotMatch(buildActionHistoryText(actions, { includeResolved: true, ids: true }), /\[a1\]/, "only a live order is cited by id");
  const bundle = { actions, game: { gameDate: "2016-01-01" }, world: {}, events: [], chats: [], advisor: [] };
  const skip = await buildPromptContext(bundle, { requiredKeys: ["plannedActions"], taskKey: "jumpForward" });
  assert.match(skip.plannedActions, /\[a3\] \(action\) Raise the reserves/);
  const advice = await buildPromptContext(bundle, { requiredKeys: ["plannedActions"], taskKey: "actions" });
  assert.doesNotMatch(advice.plannedActions, /\[a3\]/);
});
