/*! Open Historia — context preflight tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/contextWindow.test.js
//
// Runs without node_modules: contextWindow.js imports nothing.

import test from "node:test";
import assert from "node:assert/strict";

import {
    CONTEXT_WINDOW_MARGIN,
    contextWindowKey,
    createContextWindowMemory,
    describeRememberedWindow,
    estimateTokens,
    nothingFitsMessage,
    parseContextWindowError,
    requestChars,
} from "./contextWindow.js";

const memoryStorage = () => {
    const values = new Map();
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => { values.set(key, String(value)); },
        removeItem: (key) => { values.delete(key); },
    };
};

// --- reading a refusal ---

test("the numbers in each provider's wording are read the right way round", () => {
    assert.deepEqual(
        parseContextWindowError("This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens. Please reduce the length of the messages."),
        { limitTokens: 128000, requestedTokens: 150000 },
    );
    assert.deepEqual(
        parseContextWindowError("maximum context length is 32768 tokens, however you requested 45000 tokens (44000 in the messages, 1000 in the completion)"),
        { limitTokens: 32768, requestedTokens: 45000 },
    );
    assert.deepEqual(
        parseContextWindowError("prompt is too long: 250123 tokens > 200000 maximum"),
        { limitTokens: 200000, requestedTokens: 250123 },
    );
    assert.deepEqual(
        parseContextWindowError("The input token count (1200000) exceeds the maximum number of input tokens allowed (1048576)."),
        { limitTokens: 1048576, requestedTokens: 1200000 },
    );
    assert.deepEqual(parseContextWindowError("Context length exceeded: 32,768"), { limitTokens: 32768, requestedTokens: null });
});

test("a refusal that states nothing states nothing", () => {
    assert.deepEqual(parseContextWindowError("the request exceeds the available context size. try increasing the context size or enable context shift"), { limitTokens: null, requestedTokens: null });
    assert.deepEqual(parseContextWindowError("Please reduce the length of the messages or completion (HTTP 400)"), { limitTokens: null, requestedTokens: null });
    assert.deepEqual(parseContextWindowError(""), { limitTokens: null, requestedTokens: null });
});

test("two bare numbers: the smaller is the window", () => {
    assert.deepEqual(parseContextWindowError("tokens: 46901 / 32768"), { limitTokens: 32768, requestedTokens: 46901 });
});

// --- sizing a request ---

test("a request is sized across the prompt, every turn and the tool declarations", () => {
    const chars = requestChars({
        systemPrompt: "a".repeat(100),
        history: [{ role: "user", parts: [{ text: "b".repeat(50) }] }, { role: "assistant", content: "c".repeat(30) }],
        tools: [{ name: "submit", schema: { type: "object" } }],
    });
    assert.equal(chars, 100 + 50 + 30 + JSON.stringify({ name: "submit", schema: { type: "object" } }).length);
    assert.equal(estimateTokens(chars), Math.ceil(chars / 4));
    assert.equal(estimateTokens(-5), 0);
});

test("the key is the model on its connection, not the list entry", () => {
    assert.equal(contextWindowKey({ id: "e1", provider: "openai_compatible", endpoint: "https://x/v1", model: "Small-32k" }), "openai_compatible|https://x/v1|small-32k");
    assert.equal(contextWindowKey({ id: "e2", provider: "openai_compatible", endpoint: "https://x/v1", model: "Small-32k" }), contextWindowKey({ id: "e1", provider: "openai_compatible", endpoint: "https://x/v1", model: "Small-32k" }));
});

// --- the memory ---

test("a stated limit is remembered, and a request that cannot fit it is refused before it is sent", () => {
    const memory = createContextWindowMemory(memoryStorage(), { now: () => 1000 });
    const key = "openai_compatible|https://x/v1|small";
    assert.equal(memory.refusal(key, 47000), "", "nothing known yet: send it and see");
    memory.learn(key, parseContextWindowError("maximum context length is 32768 tokens, however you requested 46901 tokens"));
    assert.deepEqual(memory.get(key), { limitTokens: 32768, source: "stated", learnedAt: 1000 });
    assert.match(memory.refusal(key, 47000), /47K tokens.*window is 33K/);
    assert.equal(memory.refusal(key, 20000), "", "well inside: sent");
    // The margin and the reserve for the answer both count.
    assert.equal(memory.refusal(key, Math.floor(32768 * CONTEXT_WINDOW_MARGIN) - 4096 - 1), "");
    assert.notEqual(memory.refusal(key, Math.floor(32768 * CONTEXT_WINDOW_MARGIN) - 4096 + 1), "");
    assert.equal(memory.refusal(key, 27000, { reserveTokens: 0 }), "");
});

test("a refusal that states nothing still teaches that THIS size did not fit", () => {
    const memory = createContextWindowMemory(memoryStorage());
    const key = "k";
    memory.learn(key, { limitTokens: null, requestTokens: 46901 });
    assert.equal(memory.get(key).tooBigTokens, 46901);
    assert.match(memory.refusal(key, 47000), /refused one of 47K before/);
    assert.equal(memory.refusal(key, 30000), "", "a smaller request is worth a try");
    // A smaller failure shrinks the guess; a stated limit replaces it.
    memory.learn(key, { limitTokens: null, requestTokens: 40000 });
    assert.equal(memory.get(key).tooBigTokens, 40000);
    memory.learn(key, { limitTokens: null, requestTokens: 45000 });
    assert.equal(memory.get(key).tooBigTokens, 40000, "a bigger failure teaches nothing new");
    memory.learn(key, { limitTokens: 32768 });
    assert.equal(memory.get(key).limitTokens, 32768);
    assert.equal(memory.get(key).source, "stated");
});

test("what was learned is forgotten in time; what the player declared is not", () => {
    let at = 0;
    const memory = createContextWindowMemory(memoryStorage(), { now: () => at });
    memory.learn("stated", { limitTokens: 32768 });
    memory.learn("seen", { limitTokens: null, requestTokens: 40000 });
    memory.declare("declared", 32768);
    at = 8 * 24 * 60 * 60 * 1000;
    assert.notEqual(memory.refusal("stated", 47000), "", "a stated limit holds for a month");
    assert.equal(memory.refusal("seen", 47000), "", "a size merely seen to fail is forgotten after a week");
    at = 31 * 24 * 60 * 60 * 1000;
    assert.equal(memory.refusal("stated", 47000), "", "...and after a month the stated one is tried again");
    assert.notEqual(memory.refusal("declared", 47000), "", "the player's own word stands");
});

test("a declared window beats what was learned, and declaring nothing forgets it", () => {
    const memory = createContextWindowMemory(memoryStorage());
    memory.learn("k", { limitTokens: 32768 });
    memory.declare("k", 200000);
    assert.equal(memory.refusal("k", 47000), "");
    assert.equal(memory.get("k").source, "declared");
    memory.declare("k", 0);
    assert.equal(memory.get("k"), null);
    memory.learn("k", { limitTokens: null, requestTokens: null });
    assert.equal(memory.get("k"), null, "nothing learned from nothing");
});

test("the memory survives a storage that refuses to write", () => {
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    const memory = createContextWindowMemory(broken);
    assert.equal(memory.learn("k", { limitTokens: 1000 }).limitTokens, 1000);
    assert.equal(memory.refusal("k", 5000), "");
});

test("a window the player set is named as theirs when it refuses a request", () => {
    const memory = createContextWindowMemory(memoryStorage());
    memory.declare("mine", 32768);
    memory.learn("learned", { limitTokens: 32768 });
    assert.equal(memory.refusal("mine", 47000), "this request is about 47K tokens and the window you set for this model is 33K");
    assert.equal(memory.refusal("learned", 47000), "this request is about 47K tokens and the model's window is 33K");
});

test("Settings is told what is remembered, until when, and nothing once it lapsed", () => {
    let at = 1000;
    const memory = createContextWindowMemory(memoryStorage(), { now: () => at });
    const formatDate = (ms) => `day ${Math.floor(ms / (24 * 60 * 60 * 1000))}`;
    assert.equal(memory.remembered("k"), null);
    assert.match(describeRememberedWindow(null, { formatDate }), /learns this model's window from its own refusal/);

    memory.learn("k", { limitTokens: 32768 });
    assert.equal(describeRememberedWindow(memory.remembered("k"), { formatDate }),
        "The model said its window is 33K tokens. A request too big for it is not sent to it until day 30.");

    memory.learn("seen", { limitTokens: null, requestTokens: 47000 });
    assert.equal(describeRememberedWindow(memory.remembered("seen"), { formatDate }),
        "The model refused a request of about 47K tokens. One that big is not sent to it until day 7.");

    memory.declare("mine", 200000);
    assert.equal(memory.remembered("mine").until, null);
    assert.equal(describeRememberedWindow(memory.remembered("mine"), { formatDate }),
        "You set this model's window to 200K tokens. A request too big for it is not sent to it.");

    at = 8 * 24 * 60 * 60 * 1000;
    assert.equal(memory.remembered("seen"), null, "lapsed, as the preflight treats it");
    assert.notEqual(memory.remembered("k"), null);

    memory.forget("k");
    assert.equal(memory.remembered("k"), null);
    assert.equal(memory.refusal("k", 470000), "", "forgotten: the next request is sent");
});

test("when nothing fits, the message names every entry and what to do", () => {
    const message = nothingFitsMessage([{ label: "small (Local)", reason: "this request is about 47K tokens and the model's window is 33K" }], 46901);
    assert.match(message, /about 47K tokens/);
    assert.match(message, /small \(Local\): this request/);
    assert.match(message, /was not sent/);
    assert.match(message, /Settings → AI/);
    assert.match(message, /forget its window/);
});
