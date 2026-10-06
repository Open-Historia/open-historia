/*! Open Historia — the output limit a request to a local model server carries: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/outputLimit.test.js
//
// The rule itself is pure (outputLimit.js); where main.jsx applies it is read
// as source, since main.jsx cannot be imported without the whole app.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { DEFAULT_ANSWER_RESERVE_TOKENS } from "./contextWindow.js";
import { LOCAL_OUTPUT_LIMIT_TOKENS, describeOutputLimit, entryOutputLimit, localOutputLimit } from "./outputLimit.js";

const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");

test("a local server that would be told nothing is told 4096, the room the preflight already leaves", () => {
    assert.equal(LOCAL_OUTPUT_LIMIT_TOKENS, 4096);
    assert.equal(LOCAL_OUTPUT_LIMIT_TOKENS, DEFAULT_ANSWER_RESERVE_TOKENS, "the request and the context preflight agree on the answer's room");
    assert.equal(localOutputLimit({ localEndpoint: true }), 4096);
    assert.equal(localOutputLimit({ localEndpoint: true, taskTokens: 0, customParams: {} }), 4096);
});

test("a hosted endpoint is left alone: no limit named still means none sent", () => {
    assert.equal(localOutputLimit({ localEndpoint: false }), 0);
    assert.equal(localOutputLimit({ localEndpoint: false, customParams: { temperature: 0.2 } }), 0);
    assert.equal(localOutputLimit(), 0);
});

test("the task's own budget and the entry's own parameter both stand; the game adds nothing over them", () => {
    assert.equal(localOutputLimit({ localEndpoint: true, taskTokens: 8192 }), 0, "the advisor names its own");
    for (const customParams of [
        { max_tokens: 2048 }, { max_completion_tokens: 12000 }, { max_new_tokens: 1024 },
        { max_length: 900 }, { n_predict: 6000 }, { num_predict: 512 }, { max_output_tokens: "3000" },
    ]) {
        assert.equal(localOutputLimit({ localEndpoint: true, customParams }), 0, JSON.stringify(customParams));
        assert.ok(entryOutputLimit(customParams) > 0, JSON.stringify(customParams));
    }
    // A parameter that is there but names no limit is not one.
    for (const customParams of [{ max_tokens: 0 }, { max_tokens: -1 }, { max_tokens: null }, { max_tokens: "lots" }, { temperature: 0.7 }, null, "max_tokens"]) {
        assert.equal(entryOutputLimit(customParams), 0, JSON.stringify(customParams));
        assert.equal(localOutputLimit({ localEndpoint: true, customParams }), 4096, JSON.stringify(customParams));
    }
});

test("the log line says what limit the request carries and who set it", () => {
    assert.equal(describeOutputLimit({ localEndpoint: false }), "(provider maximum)");
    assert.equal(describeOutputLimit({ localEndpoint: false, taskTokens: 8192 }), 8192);
    assert.equal(describeOutputLimit({ localEndpoint: true, taskTokens: 8192 }), 8192);
    assert.match(String(describeOutputLimit({ localEndpoint: true })), /^4096 \(local server/);
    // The entry's parameter is spread into the request last, so it is the one in force.
    assert.equal(describeOutputLimit({ localEndpoint: true, taskTokens: 8192, customParams: { max_tokens: 2048 } }), "2048 (set on the entry)");
    assert.equal(describeOutputLimit({ localEndpoint: false, customParams: { max_completion_tokens: 12000 } }), "12000 (set on the entry)");
});

test("the OpenAI-style request adds it only where nothing else names a limit, and under the entry's own parameters", () => {
    const from = main.indexOf("async function callOpenAIStyleChatCompletions(");
    const call = main.slice(from, main.indexOf("async function callOpenAI(", from));
    assert.match(call, /const localLimit = localOutputLimit\(\{ localEndpoint: streamLocalEndpoint, taskTokens: maxTokens, customParams: requestCustomParams \}\);/);
    const ownLimit = call.indexOf("? { [tokenLimitField]: Number(maxTokens) + (wantsReasoning && !tool ? REASONING_HEADROOM_TOKENS : 0) }");
    const added = call.indexOf(": (localLimit ? { [tokenLimitField]: localLimit } : {})),");
    const custom = call.indexOf("...requestCustomParams,");
    assert.ok(ownLimit > -1 && added > ownLimit, "the task's own budget is tried first");
    assert.ok(custom > added, "and the entry's custom parameters are spread after, so they still win");
});

test("the request's log line carries the limit for the entry it is going to", () => {
    assert.match(main, /maxTokens: outputLimitShown\(entry\)/);
    const from = main.indexOf("const outputLimitShown = (entry) =>");
    assert.notEqual(from, -1);
    const shown = main.slice(from, main.indexOf("\n    };", from));
    assert.match(shown, /describeOutputLimit\(\{/);
    assert.match(shown, /localEndpoint: entry\.provider === "openai-compatible" && isLocalEndpoint\(normalizeEndpoint\(entry\.endpoint\)\)/);
});
