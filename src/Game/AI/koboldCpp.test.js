/*! Open Historia — KoboldCpp recognition tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/koboldCpp.test.js
//
// Runs without node_modules: koboldCpp.js and contextWindow.js import nothing.
//
// The bodies below are the shapes KoboldCpp's own source writes
// (koboldcpp.py): a whole chat completion and a chunk of a streamed one as
// 1.122 sends them, and the id builds up to about 1.100 put on every chunk.

import test from "node:test";
import assert from "node:assert/strict";

import {
    KOBOLDCPP_ENDPOINTS_KEY,
    createKoboldCppMemory,
    endpointOriginOf,
    isKoboldCppModelName,
    saysKoboldCpp,
} from "./koboldCpp.js";
import { LOCAL_OUTPUT_LIMIT_TOKENS, outputLimitFor } from "./contextWindow.js";

const memoryStorage = () => {
    const values = new Map();
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => { values.set(key, String(value)); },
    };
};

const KOBOLD = "http://localhost:5001/v1";
const WHOLE_BODY = {
    id: "chatcmpl-A1",
    object: "chat.completion",
    created: 1759630000,
    model: "koboldcpp/Qwen3-8B-Q4_K_M",
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
};
const STREAM_CHUNK = {
    id: "chatcmpl-A1",
    object: "chat.completion.chunk",
    created: 1759630000,
    model: "koboldcpp/Qwen3-8B-Q4_K_M",
    choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: "{" } }],
};
const LLAMA_CPP_BODY = {
    id: "chatcmpl-9f2c",
    object: "chat.completion",
    model: "Qwen3-8B-Q4_K_M.gguf",
    choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
};

// --- recognising it ---

test("a whole answer names KoboldCpp by the prefix on its model", () => {
    assert.equal(saysKoboldCpp(WHOLE_BODY), true);
    // The prefix is KoboldCpp's whatever the model is called, a renamed one included.
    assert.equal(saysKoboldCpp({ ...WHOLE_BODY, model: "koboldcpp/my own name" }), true);
});

test("a chunk of a stream does too, by its model or, on the builds that sent it, by its id", () => {
    assert.equal(saysKoboldCpp(STREAM_CHUNK), true);
    assert.equal(saysKoboldCpp({ id: "koboldcpp", object: "chat.completion.chunk", created: 1759630000, model: "koboldcpp/Qwen3-8B-Q4_K_M", choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: "{" } }] }), true);
    // The id alone would do, were a proxy to rename the model on the way.
    assert.equal(saysKoboldCpp({ id: "koboldcpp", object: "chat.completion.chunk", model: "local-model", choices: [{ delta: { content: "{" } }] }), true);
    assert.equal(saysKoboldCpp({ id: "koboldcpp", object: "chat.completion.chunk", choices: [{ delta: { content: "{" } }] }), true);
    // The envelope a stream is rebuilt into carries the same two fields (streamAssembly.js).
    assert.equal(saysKoboldCpp({ id: "chatcmpl-A1", model: "koboldcpp/Qwen3-8B-Q4_K_M", choices: [{ finish_reason: "stop", message: { content: "{}" } }] }), true);
});

test("the model an entry is set to: the id KoboldCpp's /v1/models lists", () => {
    assert.equal(isKoboldCppModelName("koboldcpp/L3-8B-Stheno-v3.2"), true);
    assert.equal(isKoboldCppModelName("  KoboldCpp/L3-8B-Stheno-v3.2 "), true, "typed by hand, with a space and a capital");
    // Only the prefix counts: these are other servers' names for a model.
    assert.equal(isKoboldCppModelName("L3-8B-Stheno-v3.2.gguf"), false);
    assert.equal(isKoboldCppModelName("models/koboldcpp/x"), false);
    assert.equal(isKoboldCppModelName("koboldcpp"), false);
    assert.equal(isKoboldCppModelName(""), false);
    assert.equal(isKoboldCppModelName(undefined), false);
    assert.equal(isKoboldCppModelName({ id: "koboldcpp/x" }), false);
});

test("another server's answer says it is not KoboldCpp, and an answer that names no model says nothing", () => {
    assert.equal(saysKoboldCpp(LLAMA_CPP_BODY), false);
    assert.equal(saysKoboldCpp({ id: "chatcmpl-1", model: "qwen/qwen3-8b", choices: [] }), false, "LM Studio's kind of name");
    assert.equal(saysKoboldCpp({ model: "qwen3:8b", choices: [] }), false, "Ollama's");
    // Nothing to go on: neither learned from nor held against the server.
    assert.equal(saysKoboldCpp({ error: { message: "Server is busy; please try again later.", type: "service_unavailable" } }), null);
    assert.equal(saysKoboldCpp({ choices: [{ delta: { content: "a" } }] }), null);
    assert.equal(saysKoboldCpp({ model: "" }), null);
    assert.equal(saysKoboldCpp({ model: 7 }), null);
    assert.equal(saysKoboldCpp({}), null);
    assert.equal(saysKoboldCpp(null), null);
    assert.equal(saysKoboldCpp("koboldcpp/x"), null);
});

// --- remembering it ---

test("an endpoint is remembered by origin, whatever path the entry spells", () => {
    assert.equal(endpointOriginOf("http://localhost:5001/v1"), "http://localhost:5001");
    assert.equal(endpointOriginOf(" HTTP://LocalHost:5001/v1/ "), "http://localhost:5001");
    assert.equal(endpointOriginOf("https://example-tunnel.trycloudflare.com/v1"), "https://example-tunnel.trycloudflare.com");
    assert.equal(endpointOriginOf("localhost:5001/v1"), "", "no scheme: not an address a request could go to");
    assert.equal(endpointOriginOf(""), "");
    assert.equal(endpointOriginOf(undefined), "");

    const memory = createKoboldCppMemory(memoryStorage());
    assert.equal(memory.knows(KOBOLD), false);
    assert.equal(memory.note(KOBOLD, WHOLE_BODY), "learned");
    assert.equal(memory.knows(KOBOLD), true);
    assert.equal(memory.knows("http://localhost:5001/v1/"), true);
    assert.equal(memory.knows("http://localhost:5001"), true);
    // Another server on the same machine is another server.
    assert.equal(memory.knows("http://localhost:1234/v1"), false);
    assert.equal(memory.knows("http://127.0.0.1:5001/v1"), false, "a different origin, even if it is the same machine");
    // Told again, nothing changes: the caller logs the change, and logs it once.
    assert.equal(memory.note(KOBOLD, STREAM_CHUNK), "");
    // An address that is not one is never remembered.
    assert.equal(memory.note("", WHOLE_BODY), "");
    assert.equal(memory.knows(""), false);
});

test("what is learned is kept for the install: a new session reads it from storage", () => {
    const storage = memoryStorage();
    const first = createKoboldCppMemory(storage);
    first.note(KOBOLD, STREAM_CHUNK);
    assert.deepEqual(JSON.parse(storage.getItem(KOBOLDCPP_ENDPOINTS_KEY)), ["http://localhost:5001"]);

    const nextSession = createKoboldCppMemory(storage);
    assert.equal(nextSession.knows(KOBOLD), true);
    assert.equal(nextSession.note(KOBOLD, WHOLE_BODY), "", "already known: learned once per install");
});

test("two tabs do not lose each other's endpoints", () => {
    const storage = memoryStorage();
    const one = createKoboldCppMemory(storage);
    const two = createKoboldCppMemory(storage);
    assert.equal(one.knows(KOBOLD), false); // both have read the empty list
    assert.equal(two.knows(KOBOLD), false);
    one.note(KOBOLD, WHOLE_BODY);
    two.note("http://192.168.1.20:5001/v1", WHOLE_BODY);
    assert.deepEqual(JSON.parse(storage.getItem(KOBOLDCPP_ENDPOINTS_KEY)).sort(), ["http://192.168.1.20:5001", "http://localhost:5001"]);
});

test("with no storage, or storage that refuses, it lasts the session and nothing breaks", () => {
    for (const storage of [
        undefined,
        null,
        {},
        { getItem: () => { throw new Error("storage is disabled"); }, setItem: () => { throw new Error("storage is disabled"); } },
        { getItem: () => "not json", setItem: () => {} },
        { getItem: () => "{\"http://localhost:5001\":true}", setItem: () => {} },
        { getItem: () => "[7,null,\"\"]", setItem: () => {} },
    ]) {
        const memory = createKoboldCppMemory(storage);
        assert.equal(memory.knows(KOBOLD), false);
        assert.equal(memory.note(KOBOLD, WHOLE_BODY), "learned");
        assert.equal(memory.knows(KOBOLD), true);
        assert.equal(memory.note(KOBOLD, LLAMA_CPP_BODY), "forgotten");
        assert.equal(memory.knows(KOBOLD), false);
    }
});

test("an endpoint that answers as another server is forgotten, in storage too", () => {
    const storage = memoryStorage();
    const memory = createKoboldCppMemory(storage);
    memory.note(KOBOLD, WHOLE_BODY);
    memory.note("http://192.168.1.20:5001/v1", WHOLE_BODY);
    // An answer that names no model leaves what is known alone.
    assert.equal(memory.note(KOBOLD, { error: { message: "busy" } }), "");
    assert.equal(memory.knows(KOBOLD), true);
    // llama.cpp was started on KoboldCpp's port: its first answer says so.
    assert.equal(memory.note(KOBOLD, LLAMA_CPP_BODY), "forgotten");
    assert.equal(memory.knows(KOBOLD), false);
    assert.deepEqual(JSON.parse(storage.getItem(KOBOLDCPP_ENDPOINTS_KEY)), ["http://192.168.1.20:5001"]);
    assert.equal(createKoboldCppMemory(storage).knows(KOBOLD), false);
    // A server never taken for KoboldCpp has nothing to forget.
    assert.equal(memory.note("http://localhost:1234/v1", LLAMA_CPP_BODY), "");
    // And KoboldCpp back on its port is learned again.
    assert.equal(memory.note(KOBOLD, STREAM_CHUNK), "learned");
});

// --- the limit it is sent (contextWindow.js outputLimitFor) ---

test("a local server that is not KoboldCpp is sent no limit, as before", () => {
    const memory = createKoboldCppMemory(memoryStorage());
    const lmStudio = { endpoint: "http://localhost:1234/v1", model: "qwen/qwen3-8b" };
    memory.note(lmStudio.endpoint, { id: "chatcmpl-1", model: "qwen/qwen3-8b", choices: [] });
    assert.equal(memory.isKoboldCpp(lmStudio), false);
    assert.deepEqual(outputLimitFor({ koboldCpp: memory.isKoboldCpp(lmStudio) }), { tokens: 0, source: "" });
    // Nor is KoboldCpp before it has answered once, when the entry's model does not say so.
    const unseen = { endpoint: KOBOLD, model: "" };
    assert.equal(memory.isKoboldCpp(unseen), false);
    assert.deepEqual(outputLimitFor({ koboldCpp: memory.isKoboldCpp(unseen) }), { tokens: 0, source: "" });
});

test("a remembered KoboldCpp endpoint is sent the limit, and so is an entry set to one of its models", () => {
    const memory = createKoboldCppMemory(memoryStorage());
    const entry = { endpoint: KOBOLD, model: "" };
    memory.note(entry.endpoint, WHOLE_BODY);
    assert.equal(memory.isKoboldCpp(entry), true);
    assert.deepEqual(outputLimitFor({ koboldCpp: memory.isKoboldCpp(entry) }), { tokens: LOCAL_OUTPUT_LIMIT_TOKENS, source: "koboldcpp" });
    assert.equal(LOCAL_OUTPUT_LIMIT_TOKENS, 4096);
    // The model name alone is enough, before the server has ever answered.
    const picked = { endpoint: "http://192.168.1.20:5001/v1", model: "koboldcpp/L3-8B-Stheno-v3.2" };
    assert.equal(memory.knows(picked.endpoint), false);
    assert.equal(memory.isKoboldCpp(picked), true);
    assert.deepEqual(outputLimitFor({ koboldCpp: memory.isKoboldCpp(picked) }), { tokens: 4096, source: "koboldcpp" });
    assert.equal(memory.isKoboldCpp(), false);
});

test("the entry's custom parameter wins over the limit, and so does a task's own cap", () => {
    const memory = createKoboldCppMemory(memoryStorage());
    memory.note(KOBOLD, WHOLE_BODY);
    const koboldCpp = memory.isKoboldCpp({ endpoint: KOBOLD, model: "" });
    assert.deepEqual(outputLimitFor({ customParams: { max_tokens: 12000 }, koboldCpp }), { tokens: 12000, source: "custom" });
    assert.deepEqual(outputLimitFor({ customParams: { max_tokens: 1024 }, koboldCpp }), { tokens: 1024, source: "custom" });
    assert.deepEqual(outputLimitFor({ maxTokens: 8192, koboldCpp }), { tokens: 8192, source: "task" });
    assert.deepEqual(outputLimitFor({ maxTokens: 8192, customParams: { max_tokens: 2048 }, koboldCpp }), { tokens: 2048, source: "custom" });
    // Custom parameters that name no limit leave it in place.
    assert.deepEqual(outputLimitFor({ customParams: { temperature: 0.7 }, koboldCpp }), { tokens: 4096, source: "koboldcpp" });
});
