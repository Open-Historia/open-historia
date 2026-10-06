/*! Open Historia — which model server is told an output limit: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/outputLimit.test.js
//
// Runs without node_modules: outputLimit.js imports nothing, and the rule that
// sets the figure (contextWindow.js) imports nothing either. Where main.jsx
// applies them is read as source, since main.jsx cannot be imported without the
// whole app.
//
// The invariants: only a KoboldCpp server is ever given a limit by the game;
// which server that is costs no request to find out; and nothing the player or
// the task set is ever replaced.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { LOCAL_OUTPUT_LIMIT_TOKENS, entryOutputLimit, outputLimitFor } from "./contextWindow.js";
import {
    KOBOLDCPP_SERVERS_KEY,
    createKoboldCppMemory,
    describeOutputLimit,
    isKoboldCppAnswer,
    isKoboldCppModel,
    koboldCppVerdict,
    serverOrigin,
} from "./outputLimit.js";
import { applyOpenAIFrame, createOpenAIStreamState, finishOpenAIStream } from "./streamAssembly.js";

const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");

const memoryStorage = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => { values.set(key, String(value)); },
        values,
    };
};

// What KoboldCpp sends, abridged: a whole chat-completions body, and one chunk
// of the same answer streamed.
const KOBOLD_BODY = {
    id: "chatcmpl-A1",
    object: "chat.completion",
    model: "koboldcpp/LFM2.5-8B-A1B-Q3.8",
    choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "length" }],
};
const KOBOLD_CHUNK = {
    id: "koboldcpp",
    object: "chat.completion.chunk",
    model: "koboldcpp/LFM2.5-8B-A1B-Q3.8",
    choices: [{ index: 0, finish_reason: null, delta: { content: "{" } }],
};

// --- which server is KoboldCpp ---

test("KoboldCpp is recognised from a whole answer body, by the model name it answers under", () => {
    assert.equal(koboldCppVerdict(KOBOLD_BODY), true);
    assert.equal(isKoboldCppAnswer(KOBOLD_BODY), true);
    // Whatever model the request asked for: the entry in the player's log was
    // named for a Gemini model, and KoboldCpp answered under its own name.
    assert.equal(isKoboldCppAnswer({ ...KOBOLD_BODY, model: "KoboldCpp/another" }), true, "the prefix, in any case");
});

test("KoboldCpp is recognised from a stream chunk, by its model name or by the id every chunk carries", () => {
    assert.equal(isKoboldCppAnswer(KOBOLD_CHUNK), true);
    assert.equal(isKoboldCppAnswer({ id: "koboldcpp", choices: [] }), true, "the id alone");
    assert.equal(isKoboldCppAnswer({ model: "koboldcpp/x", choices: [] }), true, "the model alone");
});

test("a stream reassembled into an envelope still says which server answered", () => {
    const state = createOpenAIStreamState();
    applyOpenAIFrame(state, KOBOLD_CHUNK);
    applyOpenAIFrame(state, { ...KOBOLD_CHUNK, choices: [{ index: 0, finish_reason: "stop", delta: { content: "}" } }] });
    const envelope = finishOpenAIStream(state);
    assert.equal(envelope.model, "koboldcpp/LFM2.5-8B-A1B-Q3.8");
    assert.equal(envelope.id, "koboldcpp");
    assert.equal(isKoboldCppAnswer(envelope), true);
    // A stream that names neither adds neither.
    const bare = createOpenAIStreamState();
    applyOpenAIFrame(bare, { choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] });
    assert.deepEqual(Object.keys(finishOpenAIStream(bare)), ["choices"]);
});

test("KoboldCpp is recognised from the model name an entry carries, typed in or discovered from its model list", () => {
    assert.equal(isKoboldCppModel("koboldcpp/LFM2.5-8B-A1B-Q3.8"), true);
    assert.equal(isKoboldCppModel("  koboldcpp/x  "), true);
    for (const other of ["gemini-3.5-flash-lite", "LFM2.5-8B-A1B-Q3.8", "my-koboldcpp/model", "koboldcpp", "", null, undefined, 7]) {
        assert.equal(isKoboldCppModel(other), false, String(other));
    }
});

test("any other server is told apart, and an answer that names no model says nothing either way", () => {
    for (const answer of [
        { id: "chatcmpl-9", model: "gpt-4o-2024-08-06", choices: [] },
        { model: "qwen3:14b", choices: [] }, // Ollama
        { id: "chatcmpl-xyz", model: "C:\\models\\qwen3.gguf", choices: [] }, // llama.cpp, by file
        { model: "deepseek/deepseek-v4.1-flash:thinking" },
    ]) {
        assert.equal(koboldCppVerdict(answer), false, answer.model);
        assert.equal(isKoboldCppAnswer(answer), false, answer.model);
    }
    for (const silent of [{ choices: [] }, { id: "chatcmpl-1" }, { model: "" }, { model: "   " }, {}, null, undefined, "koboldcpp/x", 5]) {
        assert.equal(koboldCppVerdict(silent), null, JSON.stringify(silent));
    }
});

// --- remembering it ---

test("a server is remembered by its origin: any path on it, and no other port or host", () => {
    assert.equal(serverOrigin("http://localhost:5001/v1"), "http://localhost:5001");
    assert.equal(serverOrigin("HTTP://LocalHost:5001/v1/"), "http://localhost:5001");
    assert.equal(serverOrigin("https://kobold.example.com/api/v1?x=1"), "https://kobold.example.com");
    assert.equal(serverOrigin("localhost:5001/v1"), "localhost:5001", "an address typed without its scheme is keyed as typed");
    for (const none of ["", "   ", null, undefined]) assert.equal(serverOrigin(none), "");

    const servers = createKoboldCppMemory();
    assert.equal(servers.has("http://localhost:5001/v1"), false);
    assert.equal(servers.remember("http://localhost:5001/v1"), true, "news");
    assert.equal(servers.remember("http://localhost:5001/v1/"), false, "known already");
    assert.equal(servers.has("http://localhost:5001/api/extra"), true);
    assert.equal(servers.has("http://localhost:5000/v1"), false, "another server on the same machine");
    assert.equal(servers.has("http://192.168.1.20:5001/v1"), false);
    assert.equal(servers.has(""), false);
    assert.equal(servers.remember(""), false);
});

test("what is learned is kept in the storage handed in, so it is learned once per install", () => {
    const storage = memoryStorage();
    const first = createKoboldCppMemory(storage);
    assert.equal(first.hear("http://localhost:5001/v1", KOBOLD_CHUNK), "learned");
    assert.deepEqual(JSON.parse(storage.values.get(KOBOLDCPP_SERVERS_KEY)), ["http://localhost:5001"]);
    // The next session, before any answer.
    const next = createKoboldCppMemory(storage);
    assert.equal(next.has("http://localhost:5001/v1"), true);
    assert.equal(next.hear("http://localhost:5001/v1", KOBOLD_BODY), "", "not news a second time");
});

test("with no storage, or one that refuses, the memory is for the session and nothing throws", () => {
    for (const storage of [
        null,
        undefined,
        {},
        { getItem: () => { throw new Error("storage is off"); }, setItem: () => { throw new Error("storage is full"); } },
        { getItem: () => "this is not JSON", setItem: () => {} },
        { getItem: () => '{"not":"a list"}', setItem: () => {} },
        { getItem: () => '[7, null, "", "http://localhost:5001"]', setItem: () => {} },
    ]) {
        const servers = createKoboldCppMemory(storage);
        assert.equal(typeof servers.has("http://localhost:5001/v1"), "boolean");
        servers.remember("http://localhost:5001/v1");
        assert.equal(servers.has("http://localhost:5001/v1"), true);
        assert.equal(servers.forget("http://localhost:5001/v1"), true);
        assert.equal(servers.has("http://localhost:5001/v1"), false);
    }
});

test("it is unlearned the way it is learned: an answer from that address under another model's name", () => {
    const storage = memoryStorage();
    const servers = createKoboldCppMemory(storage);
    servers.hear("http://localhost:5001/v1", KOBOLD_BODY);
    // The player now runs llama.cpp on the same port.
    assert.equal(servers.hear("http://localhost:5001/v1", { model: "qwen3-14b.gguf", choices: [] }), "unlearned");
    assert.equal(servers.has("http://localhost:5001/v1"), false);
    assert.deepEqual(JSON.parse(storage.values.get(KOBOLDCPP_SERVERS_KEY)), []);
    // An answer that says nothing changes nothing, either way.
    assert.equal(servers.hear("http://localhost:5001/v1", { choices: [] }), "");
    servers.remember("http://localhost:5001/v1");
    assert.equal(servers.hear("http://localhost:5001/v1", { choices: [] }), "");
    assert.equal(servers.has("http://localhost:5001/v1"), true);
    // And an answer from a server never thought to be KoboldCpp is no news.
    assert.equal(servers.hear("https://api.openai.com/v1", { model: "gpt-4o", choices: [] }), "");
});

// --- the figure, and who gets it (contextWindow.js) ---

test("a remembered KoboldCpp server is told 4096 when nothing else names a limit", () => {
    assert.equal(LOCAL_OUTPUT_LIMIT_TOKENS, 4096);
    assert.equal(outputLimitFor({ koboldCpp: true }), 4096);
    assert.equal(outputLimitFor({ koboldCpp: true, taskTokens: 0, customParams: {} }), 4096);
});

test("no other endpoint is given a limit: a local server that is not KoboldCpp gets none, as before", () => {
    // llama.cpp, LM Studio and Ollama read "no limit" as none: a figure could
    // only cut short an answer that completes today.
    assert.equal(outputLimitFor({ koboldCpp: false }), 0);
    assert.equal(outputLimitFor({ koboldCpp: false, customParams: { temperature: 0.2 } }), 0);
    assert.equal(outputLimitFor({ koboldCpp: false, capLifted: true, taskTokens: 8192 }), 0);
    assert.equal(outputLimitFor(), 0);
});

test("a custom parameter on the entry wins, under any of the names a server takes one by", () => {
    for (const customParams of [
        { max_tokens: 2048 }, { max_completion_tokens: 12000 }, { max_new_tokens: 1024 },
        { max_length: 900 }, { n_predict: 6000 }, { num_predict: 512 }, { max_output_tokens: "3000" },
    ]) {
        assert.equal(outputLimitFor({ koboldCpp: true, customParams }), 0, JSON.stringify(customParams));
        assert.equal(outputLimitFor({ koboldCpp: true, customParams, capLifted: true, taskTokens: 8192 }), 0, JSON.stringify(customParams));
        assert.ok(entryOutputLimit(customParams) > 0, JSON.stringify(customParams));
    }
    // A parameter that is there but names no limit is not one.
    for (const customParams of [{ max_tokens: 0 }, { max_tokens: -1 }, { max_tokens: null }, { max_tokens: "lots" }, { temperature: 0.7 }, null, "max_tokens"]) {
        assert.equal(entryOutputLimit(customParams), 0, JSON.stringify(customParams));
        assert.equal(outputLimitFor({ koboldCpp: true, customParams }), 4096, JSON.stringify(customParams));
    }
});

test("the task's own budget wins: the request carries that one itself", () => {
    assert.equal(outputLimitFor({ koboldCpp: true, taskTokens: 8192 }), 0, "the advisor names its own");
    assert.equal(outputLimitFor({ koboldCpp: true, taskTokens: 1024 }), 0, "a smaller one too: it was asked for");
});

test("lifting the task's budget for a model that only thought never leaves a KoboldCpp server with less room than before", () => {
    // To any other server "no limit" is its maximum. To KoboldCpp it is the
    // small default, so the limit stays: the larger of the two figures.
    assert.equal(outputLimitFor({ koboldCpp: true, taskTokens: 16384, capLifted: true }), 16384);
    assert.equal(outputLimitFor({ koboldCpp: true, taskTokens: 1024, capLifted: true }), 4096);
    assert.equal(outputLimitFor({ koboldCpp: true, capLifted: true }), 4096);
});

// --- the log line ---

test("the request's log line says the figure and whose it is", () => {
    assert.equal(describeOutputLimit(), "(provider maximum)");
    assert.equal(describeOutputLimit({ taskTokens: 8192 }), "8192 (the task's own)");
    assert.equal(describeOutputLimit({ taskTokens: 8192, reasoningHeadroom: 8192 }), "16384 (the task's own 8192, with 8192 of room for reasoning)");
    assert.match(describeOutputLimit({ gameTokens: 4096 }), /^4096 \(set by the game: a KoboldCpp server/);
    // The entry's parameter is spread into the request last, so it is the one in force.
    assert.equal(describeOutputLimit({ entryTokens: 2048, taskTokens: 8192, gameTokens: 4096 }), "2048 (set on the entry)");
    // The task's stands over the game's (which is 0 then anyway).
    assert.equal(describeOutputLimit({ taskTokens: 8192, gameTokens: 4096 }), "8192 (the task's own)");
    for (const none of [{ entryTokens: 0, taskTokens: null, gameTokens: -1 }, { taskTokens: "many" }]) {
        assert.equal(describeOutputLimit(none), "(provider maximum)");
    }
});

// --- where main.jsx applies it ---

const caller = () => {
    const from = main.indexOf("async function callOpenAIStyleChatCompletions(");
    return main.slice(from, main.indexOf("async function callOpenAI(", from));
};

test("the request adds the limit for a remembered KoboldCpp server only, and under everything else that names one", () => {
    const call = caller();
    assert.match(call, /const koboldLimit = outputLimitFor\(\{\s*koboldCpp: koboldCppServers\.has\(endpoint\),\s*taskTokens: taskLimit,\s*customParams: requestCustomParams,\s*capLifted: liftedCapForReasoning,\s*\}\);/);
    const ownLimit = call.indexOf("? { [tokenLimitField]: taskLimit }");
    const added = call.indexOf(": (koboldLimit ? { [tokenLimitField]: koboldLimit } : {})),");
    const custom = call.indexOf("...requestCustomParams,");
    assert.ok(ownLimit > -1 && added > ownLimit, "the task's own budget is tried first");
    assert.ok(custom > added, "and the entry's custom parameters are spread after, so they still win");
    // Locality decides nothing any more: a local server that is not KoboldCpp
    // is sent no limit.
    assert.equal(/outputLimitFor\(\{[^}]*(?:localEndpoint|isLocalEndpoint)/.test(main), false);
});

test("the server is learned from the model's own name before the first request, and from every answer after", () => {
    const call = caller();
    const named = call.indexOf('if (isKoboldCppModel(model)) noteServerKind(endpoint, koboldCppServers.remember(endpoint) ? "learned" : "");');
    const firstRequest = call.indexOf("await providerFetch(");
    assert.ok(named > -1 && named < firstRequest, "a model named koboldcpp/… is known before anything is sent");
    // Both ways an answer is read: the envelope (whole, or reassembled from a
    // stream) and the chat stream.
    assert.match(call, /onUsage\?\.\(data\);\s*(?:\/\/[^\n]*\s*)*noteServerKind\(endpoint, koboldCppServers\.hear\(endpoint, data\)\);/);
    assert.match(call, /const streamResult = await streamTextSSE\(response, openaiStreamDelta, onChunk, providerLabel\);\s*noteServerKind\(endpoint, koboldCppServers\.hear\(endpoint, streamResult\.servedBy\)\);/);
    // No request is made to find out.
    assert.equal(/koboldcpp|kobold/i.test(main.slice(main.indexOf("async function resolveConfiguredModel("), main.indexOf("async function matchServedModel("))), false);
    assert.equal(call.split("providerFetch(").length - 1, 1, "one place a request goes out, as before");
});

test("the memory is kept with the other AI settings, behind the guarded storage", () => {
    assert.match(main, /export const koboldCppServers = createKoboldCppMemory\(settingsStorage\);/);
    const storage = main.slice(main.indexOf("const settingsStorage = {"), main.indexOf("export const contextWindows"));
    assert.match(storage, /getItem: \(key\) => \{ try \{ return localStorage\.getItem\(key\); \} catch \{ return null; \} \},/);
    assert.match(storage, /setItem: \(key, value\) => \{ try \{ localStorage\.setItem\(key, value\); \} catch/);
});

test("learning a server, or unlearning one, is said once in the log", () => {
    const note = main.slice(main.indexOf("const noteServerKind = (endpoint, change) => {"), main.indexOf("async function callOpenAIStyleChatCompletions("));
    assert.match(note, /if \(change === "learned"\) \{\s*logDebugEvent\("ai", `\$\{endpointOrigin\(endpoint\)\} is a KoboldCpp server/);
    assert.match(note, /now carries max_tokens \$\{LOCAL_OUTPUT_LIMIT_TOKENS\}/);
    assert.match(note, /\} else if \(change === "unlearned"\) \{\s*logDebugEvent\("ai", `\$\{endpointOrigin\(endpoint\)\} no longer answers as a KoboldCpp server/);
});

test("the request's log line carries the limit for the entry it is going to, by the same rules as the request", () => {
    assert.match(main, /limitShown = outputLimitShown\(entry\);\s*logDebugEvent\("ai-call", `\$\{label\}: request to[^\n]*\{ \.\.\.callShape, maxTokens: limitShown \}/);
    const from = main.indexOf("const outputLimitShown = (entry) => {");
    assert.notEqual(from, -1);
    const shown = main.slice(from, main.indexOf("\n    };", from));
    assert.match(shown, /return describeOutputLimit\(\{/);
    assert.match(shown, /entryTokens: entryOutputLimit\(customParams\),/);
    assert.match(shown, /reasoningHeadroom: taskTokens && getReasoningEnabled\(\) && !providerOpts\.tool \? REASONING_HEADROOM_TOKENS : 0,/);
    assert.match(shown, /koboldCpp: entry\.provider === "openai-compatible" && \(isKoboldCppModel\(entry\.model\) \|\| koboldCppServers\.has\(entry\.endpoint\)\),/);
    // The line that says an answer ran into its limit states the limit the
    // request went out under, not one the answer has since taught.
    assert.match(main, /stopped at its output limit; the answer may be cut short\.`, \{[^}]*maxTokens: limitShown,/);
});
