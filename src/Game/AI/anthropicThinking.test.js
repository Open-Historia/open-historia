/*! Open Historia — Anthropic extended thinking per model: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/anthropicThinking.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { isEnabledThinkingRefusal, thinkingFor, thinksAdaptive } from "./anthropicThinking.js";

test("the newer Claude models think adaptive, older ones keep a budget", () => {
    for (const model of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-4-7", "claude-sonnet-4-6", "claude-fable-5-1", "claude-mythos-5-1",
        "us.anthropic.claude-sonnet-5-5", "anthropic.claude-opus-4-8", "claude-sonnet-5-5@20261001", " Claude-Opus-5 "]) {
        assert.equal(thinksAdaptive(model), true, model);
    }
    for (const model of ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5", "claude-3-7-sonnet-20250219", "", "gpt-5"]) {
        assert.equal(thinksAdaptive(model), false, model);
    }
    assert.deepEqual(thinkingFor({ adaptive: true }), { type: "adaptive" });
    assert.deepEqual(thinkingFor({ adaptive: false }), { type: "enabled", budget_tokens: 4096 });
});

test("the API's refusal of a thinking budget is recognised", () => {
    assert.equal(isEnabledThinkingRefusal('{"type":"error","error":{"type":"invalid_request_error","message":"\\"thinking.type.enabled\\" is not supported for this model. Use \\"thinking.type.adaptive\\" and \\"output_config.effort\\" to control thinking behavior."}}'), true);
    assert.equal(isEnabledThinkingRefusal("max_tokens: 200000 > 128000"), false);
});
