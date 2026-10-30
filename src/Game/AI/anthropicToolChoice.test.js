/*! Open Historia — Anthropic tool_choice tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/anthropicToolChoice.test.js
//
// A model wrongly treated as forceable loses every structured call to a 400; a
// model wrongly treated as unforceable loses the guarantee that it answers
// through the tool. Both directions are pinned here.

import test from "node:test";
import assert from "node:assert/strict";
import {
    isForcedToolChoiceRefusal,
    refusesForcedToolChoice,
    structuredToolChoice,
    toolCallReminder,
    withToolCallReminder,
} from "./anthropicToolChoice.js";

test("models that refuse a forced tool_choice are recognised, with platform prefixes and suffixes", () => {
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1",
        "anthropic.claude-opus-5-5", "us.anthropic.claude-sonnet-5-5", "claude-sonnet-5-5@20261001", " Claude-Opus-5-5 "]) {
        assert.equal(refusesForcedToolChoice(model), true, model);
    }
});

test("models that accept a forced tool_choice keep it", () => {
    for (const model of ["claude-haiku-4-5", "claude-haiku-5-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8",
        "claude-fable-5", "claude-opus-5-50", "", null, undefined]) {
        assert.equal(refusesForcedToolChoice(model), false, String(model));
    }
});

test("the 400 for a forced tool_choice is recognised, and other 400s are not", () => {
    assert.equal(isForcedToolChoiceRefusal('tool_choice: type "tool" and "any" are not supported for this model.'), true);
    assert.equal(isForcedToolChoiceRefusal("max_tokens: 200000 > 128000, which is the maximum"), false);
    assert.equal(isForcedToolChoiceRefusal("temperature is not supported for this model"), false);
    assert.equal(isForcedToolChoiceRefusal(undefined), false);
});

test("tool_choice is forced as before where allowed, and auto where not", () => {
    assert.deepEqual(structuredToolChoice({ forced: true, toolName: "turn", lookupsAllowed: true }), { type: "any" });
    assert.deepEqual(structuredToolChoice({ forced: true, toolName: "turn", lookupsAllowed: false }), { type: "tool", name: "turn" });
    assert.deepEqual(structuredToolChoice({ forced: false, toolName: "turn", lookupsAllowed: true }), { type: "auto" });
    assert.deepEqual(structuredToolChoice({ forced: false, toolName: "turn", lookupsAllowed: false }), { type: "auto" });
});

test("the reminder names the answer tool, and the lookups only while they are allowed", () => {
    assert.match(toolCallReminder({ toolName: "submit_turn", lookupsAllowed: false }), /submit_turn tool now/);
    assert.match(toolCallReminder({ toolName: "submit_turn", lookupsAllowed: true }), /lookup tools.*submit_turn/);
});

test("the reminder ends the last user turn, after any tool results, without mutating", () => {
    const toolResult = { type: "tool_result", tool_use_id: "t1", content: "42" };
    const history = [
        { role: "user", content: "Plan the turn." },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "lookup", input: {} }] },
        { role: "user", content: [toolResult] },
    ];
    const frozen = structuredClone(history);
    const out = withToolCallReminder(history, "Call it.");
    assert.deepEqual(history, frozen);
    assert.equal(out.length, 3);
    assert.deepEqual(out[2].content, [toolResult, { type: "text", text: "Call it." }]);

    assert.deepEqual(withToolCallReminder([{ role: "user", content: "Hi" }], "Call it.")[0].content,
        [{ type: "text", text: "Hi" }, { type: "text", text: "Call it." }]);
    assert.deepEqual(withToolCallReminder([{ role: "user", content: "Hi" }, { role: "assistant", content: "Ok" }], "Call it.").at(-1),
        { role: "user", content: [{ type: "text", text: "Call it." }] });
});
