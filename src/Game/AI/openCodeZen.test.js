/*! Open Historia — portions (OpenCode Zen adapter regression tests) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    OPENCODE_ZEN_ENDPOINT, normalizeZenModel, isZenChatModel, isZenFreeModel,
    zenChatModels, pickZenFreeModel, validateZenModel,
} from "./openCodeZen.js";

// Representative IDs from the public Zen catalogue and its documented endpoint
// table, including the trap: some names ending in -free use Responses instead.
const catalogue = { data: [
    { id: "claude-haiku-4-5" }, { id: "gpt-5-nano" }, { id: "gemini-3-flash" },
    { id: "qwen3.6-plus" }, { id: "grok-4.5" },
    { id: "muse-spark-1.3-contributor-free" },
    { id: "deepseek-v4-flash" }, { id: "mimo-v2.5-free" },
    { id: "big-pickle" }, { id: "glm-5" }, { id: "minimax-m2.5" },
    { id: "kimi-k2.5" }, { id: "nemotron-3-ultra-free" },
    { id: "ling-3.0-flash-fin-free" }, { id: "mimo-v2.5-free" },
    {}, null, { id: 12 },
] };

test("Zen catalogue only offers supported Chat Completions models, free first", () => {
    const ids = zenChatModels(catalogue);
    assert.equal(ids[0], "big-pickle");
    assert.equal(ids.length, 8);
    assert.ok(ids.every(isZenChatModel));
    assert.equal(ids.filter((id) => id === "mimo-v2.5-free").length, 1);
    assert.deepEqual(zenChatModels({ data: null }), []);
    assert.deepEqual(zenChatModels({ data: {} }), []);
    assert.deepEqual(zenChatModels(null), []);
    for (const id of ["gpt-5-nano", "claude-haiku-4-5", "gemini-3-flash", "qwen3.6-plus", "grok-4.5", "muse-spark-1.3-contributor-free"]) {
        assert.equal(isZenChatModel(id), false);
        assert.equal(isZenFreeModel(id), false);
        assert.throws(() => validateZenModel(id, true), /not supported/);
    }
});

test("auto-selection never falls back to a paid or unsupported model", () => {
    assert.equal(pickZenFreeModel(zenChatModels(catalogue)), "big-pickle");
    assert.equal(pickZenFreeModel(["deepseek-v4-flash", "mimo-v2.5-free"]), "mimo-v2.5-free");
    assert.equal(pickZenFreeModel(["deepseek-v4-flash", "muse-spark-1.3-contributor-free"]), "");
    assert.equal(pickZenFreeModel([]), "");
});

test("manual models accept the OpenCode prefix, but paid models need opt-in", () => {
    assert.equal(normalizeZenModel("  opencode/big-pickle  "), "big-pickle");
    assert.equal(validateZenModel("opencode/mimo-v2.5-free"), "mimo-v2.5-free");
    assert.throws(() => validateZenModel("deepseek-v4-flash"), /Paid.*disabled/);
    assert.equal(validateZenModel("deepseek-v4-flash", true), "deepseek-v4-flash");
    assert.throws(() => validateZenModel(""), /not supported/);
    assert.throws(() => validateZenModel("unknown-free"), /not supported/);
});

// main.jsx imports the whole game/DOM graph. Exercise its actual adapter body
// with injected transport/config, as the desktop port-probe tests do, without
// booting a map or making network requests in the test suite. The shared SSE
// parser and structured ladder have their own regression tests.
const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const adapterSource = source.slice(source.indexOf("export async function discoverOpenCodeZenModels("), source.indexOf("async function callOpenAICompatible("))
    .replace("export async function", "async function");

function adapter({ model = "", taskModel = "", apiKey = "test-only-key", allowPaid = "", customParams = "", local = true, fetchError, data = catalogue, status = 200 } = {}) {
    const requests = [];
    const calls = [];
    const recent = [];
    const dependencies = {
        OPENCODE_ZEN_ENDPOINT, pickZenFreeModel, validateZenModel, zenChatModels,
        PAGE_IS_LOCAL: local,
        providerFetch: async (url, options) => {
            requests.push({ url, options });
            if (fetchError) throw fetchError;
            return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
        },
        getProviderSettings: (provider) => {
            assert.equal(provider, "opencode-zen");
            return { apiKey, customParams, structuredMode: "json_object" };
        },
        getProviderField: (provider, field) => { assert.equal(provider, "opencode-zen"); assert.equal(field, "allowPaid"); return allowPaid; },
        getModelForTask: (provider, task) => { assert.equal(provider, "opencode-zen"); return task === "advisor" && taskModel ? taskModel : model; },
        parseCustomParams: (raw) => raw ? JSON.parse(raw) : {},
        saveRecentModel: (provider, id) => recent.push({ provider, id }),
        callOpenAIStyleChatCompletions: async (options) => { calls.push(options); return "answer"; },
        readErrorPayload: (response) => response.json(),
        extractErrorMessage: (payload, fallback) => payload.error?.message ?? fallback,
    };
    const functions = new Function(...Object.keys(dependencies), `${adapterSource}\nreturn { callOpenCodeZen, discoverOpenCodeZenModels, zenFetch };`)(...Object.values(dependencies));
    return { ...functions, calls, requests, recent };
}

test("Zen dispatch, key, fixed endpoint and shared streaming/tool transport", async () => {
    const a = adapter({ model: "opencode/mimo-v2.5-free", customParams: '{"temperature":0.2}' });
    const signal = new AbortController().signal;
    const tool = { name: "submit_test", schema: { type: "object" } };
    let reported;
    const onChunk = () => {};
    assert.equal(await a.callOpenCodeZen("system", [], { signal, tool, onChunk, onModel: (id) => { reported = id; } }), "answer");
    assert.equal(a.requests.length, 0);
    const call = a.calls[0];
    assert.equal(call.endpoint, "https://opencode.ai/zen/v1");
    assert.equal(call.headers.Authorization, "Bearer test-only-key");
    assert.equal(call.model, "mimo-v2.5-free");
    assert.equal(reported, call.model);
    assert.deepEqual(call.customParams, { temperature: 0.2 });
    assert.equal(call.signal, signal);
    assert.equal(call.tool, tool);
    assert.equal(call.onChunk, onChunk);
    assert.equal(call.allowJsonSchemaFallback, true);
    assert.equal(call.configuredStructuredMode, "json_object");
    assert.equal(call.observerKey, "opencode-zen|mimo-v2.5-free");
    // Pin the wiring as well as the adapter: normal callAI dispatch must reach it.
    assert.match(source, /case "opencode-zen":\s*return callOpenCodeZen\(systemPrompt, history, providerOpts\)/);
});

test("discovery sends no key and blank model only uses the public free catalogue", async () => {
    const a = adapter();
    await a.callOpenCodeZen("system", []);
    assert.equal(a.requests[0].url, `${OPENCODE_ZEN_ENDPOINT}/models`);
    assert.equal(a.requests[0].options.method, "GET");
    assert.equal(a.requests[0].options.headers, undefined);
    assert.equal(a.calls[0].model, "big-pickle");
    const paidOnly = adapter({ data: { data: [{ id: "deepseek-v4-flash" }] }, allowPaid: "1" });
    await assert.rejects(paidOnly.callOpenCodeZen("system", []), /No supported free/);
    assert.equal(paidOnly.calls.length, 0);
});

test("missing key, task overrides and custom JSON cannot bypass paid opt-in", async () => {
    const missing = adapter({ apiKey: " " });
    await assert.rejects(missing.callOpenCodeZen("s", []), /create and paste/);
    assert.equal(missing.requests.length, 0);
    for (const options of [
        { model: "deepseek-v4-flash" },
        { model: "big-pickle", taskModel: "deepseek-v4-flash" },
        { model: "big-pickle", customParams: '{"model":"deepseek-v4-flash"}' },
    ]) {
        const blocked = adapter(options);
        await assert.rejects(blocked.callOpenCodeZen("s", [], { taskKey: "advisor" }), /Paid.*disabled/);
        assert.equal(blocked.calls.length, 0);
        const allowed = adapter({ ...options, allowPaid: "1" });
        await allowed.callOpenCodeZen("s", [], { taskKey: "advisor" });
        assert.equal(allowed.calls[0].model, "deepseek-v4-flash");
        assert.equal(allowed.calls[0].customParams.model, undefined);
    }
});

test("Zen fetch errors explain CORS on hosted pages and preserve cancellation/HTTP errors", async () => {
    const cors = adapter({ local: false, fetchError: new TypeError("Failed to fetch") });
    await assert.rejects(cors.discoverOpenCodeZenModels(), /CORS.*desktop/);
    const local = adapter({ fetchError: new TypeError("offline") });
    await assert.rejects(local.discoverOpenCodeZenModels(), /offline/);
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("Aborted", "AbortError");
    const cancelled = adapter({ local: false, fetchError: abort });
    await assert.rejects(cancelled.discoverOpenCodeZenModels({ signal: controller.signal }), (error) => error === abort);
    const unavailable = adapter({ status: 503, data: { error: { message: "Zen unavailable" } } });
    await assert.rejects(unavailable.discoverOpenCodeZenModels(), /Zen unavailable/);
    const explicitModel = adapter({ model: "big-pickle", local: false, fetchError: new TypeError("Failed to fetch") });
    await explicitModel.callOpenCodeZen("s", []);
    await assert.rejects(explicitModel.calls[0].fetchRequest(`${OPENCODE_ZEN_ENDPOINT}/chat/completions`, {}), /CORS.*desktop/);
});
