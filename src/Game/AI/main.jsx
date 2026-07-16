/*! Open Historia — portions (server relay for OpenAI-style APIs + reasoning toggle) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import {
    getProviderSettings,
    getReasoningEnabled,
    getStoredProvider,
    providerSupportsModelDiscovery,
    setProviderField,
} from "./providerConfig.js";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { languageDirective } from "../../runtime/i18n.js";
import { difficultyDirective } from "../../runtime/difficulty.js";
import { normalizePromptPack } from "./gameplayPrompts.js";
import {
    buildPromptContext,
    renderTemplate,
    resolveHelperValues,
} from "./promptContext.js";

// main.jsx - AI chat module
// Supports Gemini, OpenAI, Anthropic, and OpenAI-compatible endpoints
// Usage: import { sendMessage, sendDiplomaticMessage, startChat, startDiplomaticChat, loadHistory, loadDiplomaticHistory, buildDiplomaticSystemPrompt } from './main.jsx'

const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const OPENAI_API_ENDPOINT = "https://api.openai.com/v1";
const ANTHROPIC_API_ENDPOINT = "https://api.anthropic.com/v1";

const CHAT_MODEL_HINTS = [
    /^gpt/i,
    /^o\d/i,
    /claude/i,
    /gemini/i,
    /llama/i,
    /mistral/i,
    /mixtral/i,
    /qwen/i,
    /deepseek/i,
    /command/i,
    /phi/i,
];

const NON_CHAT_MODEL_HINTS = [
    /embedding/i,
    /moderation/i,
    /whisper/i,
    /tts/i,
    /transcribe/i,
    /speech/i,
    /image/i,
    /rerank/i,
];

function sleep(ms, signal) {
    if (signal?.aborted) {
        return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}

const canRetryBeforeDeadline = (deadline, retryDelay) =>
    !Number.isFinite(deadline) || Date.now() + retryDelay < deadline;

function normalizeEndpoint(endpoint) {
    return (endpoint ?? "").trim().replace(/\/$/, "");
}

function normalizeGeminiModel(model) {
    return (model ?? "").replace(/^models\//, "").trim();
}

async function readErrorPayload(response) {
    const text = await response.text();

    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch {
        return { rawText: text };
    }
}

function extractErrorMessage(payload, fallback) {
    if (!payload) return fallback;
    if (typeof payload === "string" && payload.trim()) return payload.trim();
    if (payload.error?.message) return payload.error.message;
    if (payload.message) return payload.message;
    if (typeof payload.rawText === "string" && payload.rawText.trim()) return payload.rawText.trim();
    return fallback;
}

// Settings (per provider): an escape hatch for request-body fields the built-in
// UI doesn't expose (e.g. reasoning budget/effort limits). Shallow-merged last
// into the outgoing body, so a deliberately-set key can override a built-in
// one; a nested built-in object (e.g. Gemini's generationConfig) must be
// supplied whole to override any of its keys. Invalid input is ignored, not
// fatal — a malformed settings field should never break a turn.
function parseCustomParams(raw, providerLabel) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return {};

    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
        console.warn(`${providerLabel} custom parameters must be a JSON object; ignoring.`);
    } catch (error) {
        console.warn(`${providerLabel} custom parameters are not valid JSON; ignoring.`, error);
    }

    return {};
}

function pickLikelyChatModel(models) {
    const modelIds = models
    .map((entry) => entry?.id)
    .filter((id) => typeof id === "string" && id.trim());

    const preferredModel = modelIds.find((id) => (
        CHAT_MODEL_HINTS.some((pattern) => pattern.test(id))
        && !NON_CHAT_MODEL_HINTS.some((pattern) => pattern.test(id))
    ));

    if (preferredModel) return preferredModel;

    const safeFallbackModel = modelIds.find((id) => (
        !NON_CHAT_MODEL_HINTS.some((pattern) => pattern.test(id))
    ));

    return safeFallbackModel ?? modelIds[0] ?? "";
}

function joinGeminiParts(parts) {
    return (parts ?? [])
    .map((part) => part?.text ?? "")
    .join("")
    .trim();
}

function extractGeminiToolInput(data, tool) {
    const call = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part?.functionCall)
    .find((entry) => entry?.name === tool?.name);
    return call?.args && typeof call.args === "object" ? call.args : null;
}

function extractOpenAIMessageText(data) {
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content === "string") {
        return content.trim();
    }

    if (Array.isArray(content)) {
        return content
        .map((part) => {
            if (typeof part === "string") return part;
            if (typeof part?.text === "string") return part.text;
            return "";
        })
        .join("")
        .trim();
    }

    return "";
}

function extractOpenAIToolInput(data, tool) {
    const call = (data?.choices?.[0]?.message?.tool_calls ?? [])
    .find((entry) => entry?.function?.name === tool?.name);
    const args = call?.function?.arguments;
    if (args && typeof args === "object") return args;
    if (typeof args !== "string") return null;

    try {
        return JSON.parse(args);
    } catch {
        return null;
    }
}

function extractOpenAIToolRaw(data, tool) {
    const call = (data?.choices?.[0]?.message?.tool_calls ?? [])
    .find((entry) => entry?.function?.name === tool?.name);
    const args = call?.function?.arguments;
    return typeof args === "string" ? args : args ? JSON.stringify(args) : "";
}

function extractAnthropicText(data) {
    return (data?.content ?? [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function extractAnthropicToolInput(data, tool) {
    const block = (data?.content ?? [])
    .find((entry) => entry?.type === "tool_use" && entry?.name === tool?.name);
    return block?.input && typeof block.input === "object" ? block.input : null;
}

function toGeminiSchema(value) {
    if (Array.isArray(value)) return value.map(toGeminiSchema);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
        Object.entries(value)
        .filter(([key]) => key !== "additionalProperties" && key !== "$schema")
        .map(([key, entry]) => [key, toGeminiSchema(entry)]),
    );
}

function getGeminiUrl(model, apiKey) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
}

// AI calls go straight from the browser to the provider so the player's API key
// only ever reaches the provider — never a server or a community node. Direct is
// always tried first. Only when the page is served from a machine the player
// controls (localhost / the LAN box the Android client loads from) do we fall
// back to that trusted server's same-origin /api/ai/relay, and only for an
// endpoint that refused the direct call (self-hosted OpenAI-/Anthropic-style
// backends like Ollama or LM Studio rarely send browser CORS headers). On a
// hosted website there is no relay, so every call is direct-only and the key is
// never handed to anything but the provider. Gemini and native Anthropic were
// already direct — both allow browser calls explicitly.

// True when this page is served from a machine the player controls, i.e. a
// trusted same-origin relay is reachable. The LAN private ranges cover the
// Android client, which loads the UI from a local server on the home network.
function isLocallyServed() {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname;
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
}

const PAGE_IS_LOCAL = isLocallyServed();
// Endpoints that have already proven they need the relay (no browser CORS) —
// remembered so we skip the doomed direct attempt on every later call.
const relayOnlyOrigins = new Set();

function endpointOrigin(url) {
    try {
        return new URL(url, typeof window !== "undefined" ? window.location.href : undefined).origin;
    } catch {
        return url;
    }
}

const relayFetch = (url, { method = "POST", headers = {}, payload, signal } = {}) =>
    fetch("/api/ai/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method, headers, payload }),
        signal,
    });

const directFetch = (url, { method = "POST", headers = {}, payload, signal } = {}) =>
    fetch(url, {
        method,
        headers,
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        signal,
    });

// fetch() rejects with a TypeError on a CORS or network failure (an HTTP error
// status still resolves). An abort rejects with an AbortError, which must not
// trigger the relay fallback.
async function providerFetch(url, options = {}) {
    const origin = endpointOrigin(url);

    if (PAGE_IS_LOCAL && relayOnlyOrigins.has(origin)) {
        return relayFetch(url, options);
    }

    try {
        return await directFetch(url, options);
    } catch (error) {
        const aborted = options.signal?.aborted || error?.name === "AbortError";
        if (PAGE_IS_LOCAL && !aborted && error instanceof TypeError) {
            relayOnlyOrigins.add(origin);
            return relayFetch(url, options);
        }
        throw error;
    }
}

function toOpenAIMessages(systemPrompt, history) {
    const messages = [{ role: "system", content: systemPrompt }];

    for (const entry of history) {
        messages.push({
            role: entry.role === "model" ? "assistant" : "user",
            content: entry.parts?.[0]?.text ?? "",
        });
    }

    return messages;
}

function toAnthropicMessages(history) {
    return history.map((entry) => ({
        role: entry.role === "model" ? "assistant" : "user",
        content: [{
            type: "text",
            text: entry.parts?.[0]?.text ?? "",
        }],
    }));
}

async function resolveModel(provider, { endpoint = "", headers = {}, fallbackModel = "", providerLabel, signal } = {}) {
    const settings = getProviderSettings(provider);
    const configuredModel = settings.model.trim();

    if (configuredModel) {
        return provider === "gemini" ? normalizeGeminiModel(configuredModel) : configuredModel;
    }

    if (fallbackModel) {
        return fallbackModel;
    }

    if (!providerSupportsModelDiscovery(provider)) {
        throw new Error(`Go to **settings** and enter a model for ${providerLabel}.`);
    }

    const normalizedEndpoint = normalizeEndpoint(endpoint);

    if (!normalizedEndpoint) {
        throw new Error(`Go to **settings** and enter an endpoint for ${providerLabel}.`);
    }

    try {
        const response = await providerFetch(`${normalizedEndpoint}/models`, { method: "GET", headers, signal });

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw new Error(extractErrorMessage(payload, `Could not load models from ${providerLabel}.`));
        }

        const data = await response.json();
        const discoveredModel = pickLikelyChatModel(data?.data ?? []);

        if (!discoveredModel) {
            throw new Error(`No models were returned by ${providerLabel}.`);
        }

        console.log(`Auto-detected ${providerLabel} model:`, discoveredModel);
        setProviderField(provider, "model", discoveredModel);
        return discoveredModel;
    } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        console.warn(`Could not auto-detect model for ${providerLabel}:`, error);
        throw new Error(`Could not auto-detect a model for ${providerLabel}. Enter a model manually in **settings**.`);
    }
}

async function callGemini(systemPrompt, history, {
    deadline,
    retries = 3,
    retryDelay = 15000,
    signal,
    tool,
} = {}) {
    const settings = getProviderSettings("gemini");
    const apiKey = settings.apiKey.trim();

    if (!apiKey) {
        throw new Error("Go to **settings** and paste your Gemini API key - you can get it at https://aistudio.google.com/app/apikey");
    }

    const model = await resolveModel("gemini", {
        fallbackModel: GEMINI_DEFAULT_MODEL,
        providerLabel: "Gemini",
        signal,
    });

    const customParams = parseCustomParams(settings.customParams, "Gemini");

    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(getGeminiUrl(model, apiKey), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: history,
                // Reasoning toggle (settings): let thinking-capable Gemini models think.
                ...(getReasoningEnabled()
                     ? { generationConfig: { thinkingConfig: { thinkingBudget: 8192 } } }
                     : {}),
                ...customParams,
                ...(tool ? {
                    tools: [{ functionDeclarations: [{
                        name: tool.name,
                        description: tool.description,
                        parameters: toGeminiSchema(tool.schema),
                    }] }],
                    toolConfig: { functionCallingConfig: {
                        mode: "ANY",
                        allowedFunctionNames: [tool.name],
                    } },
                } : {}),
            }),
            signal,
        });

        if (response.status === 429) {
            const payload = await readErrorPayload(response);
            const details = extractErrorMessage(payload, "Gemini returned 429.");
            throw new Error(`Gemini returned 429. Your balance or quota appears to be exhausted. ${details}`.trim());
        }

        if (response.status === 503) {
            if (attempt === retries || !canRetryBeforeDeadline(deadline, retryDelay)) {
                throw new Error(`Gemini is temporarily unavailable after ${retries} attempts. Try again in a minute.`);
            }

            console.warn(`Gemini is busy. Retrying in ${retryDelay / 1000}s... (attempt ${attempt}/${retries})`);
            await sleep(retryDelay, signal);
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw new Error(extractErrorMessage(payload, `Gemini API request failed (${response.status})`));
        }

        const data = await response.json();
        if (tool) {
            const toolInput = extractGeminiToolInput(data, tool);
            if (toolInput) return { rawText: joinGeminiParts(data?.candidates?.[0]?.content?.parts), toolInput };
            return { rawText: joinGeminiParts(data?.candidates?.[0]?.content?.parts), toolInput: null };
        }
        const text = joinGeminiParts(data?.candidates?.[0]?.content?.parts);

        if (!text) {
            throw new Error("Gemini response did not contain text.");
        }

        return text;
    }
}

async function callOpenAIStyleChatCompletions({
    endpoint,
    headers,
    model,
    systemPrompt,
    history,
    providerLabel,
    customParams = {},
    retries = 3,
    retryDelay = 15000,
    deadline,
    signal,
    tool,
    allowJsonSchemaFallback = false,
    maxTokens = 8192,
    tokenLimitField = "max_tokens",
}) {
    let structuredMode = tool ? "tool" : "text";
    let disableToolReasoning = false;

    let attempt = 1;
    while (attempt <= retries) {
        const requestCustomParams = { ...customParams };
        if (disableToolReasoning) {
            delete requestCustomParams.reasoning;
        }
        const requestSystemPrompt = structuredMode === "text_json" || structuredMode === "json_object"
            ? `${systemPrompt}\n\nReturn only one JSON object matching this JSON Schema. Do not use markdown or prose outside the object.\n${JSON.stringify(tool.schema)}`
            : systemPrompt;
        const response = await providerFetch(`${normalizeEndpoint(endpoint)}/chat/completions`, {
            headers,
            signal,
            payload: {
                model,
                messages: toOpenAIMessages(requestSystemPrompt, history),
                // Reasoning toggle (settings) — honored by o-series/gpt-5 models and
                // most OpenAI-compatible gateways; models that reject it surface a
                // clear API error so the user knows to pick a reasoning model.
                ...(getReasoningEnabled() && structuredMode !== "tool" ? { reasoning_effort: "medium" } : {}),
                [tokenLimitField]: Math.max(8192, Number(maxTokens) || 0),
                ...requestCustomParams,
                ...(structuredMode === "tool" && disableToolReasoning ? { reasoning_effort: "none" } : {}),
                ...(structuredMode === "tool" ? {
                    tools: [{ type: "function", function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.schema,
                    } }],
                    tool_choice: { type: "function", function: { name: tool.name } },
                } : {}),
                ...(structuredMode === "json_schema" ? {
                    response_format: { type: "json_schema", json_schema: {
                        name: tool.name,
                        schema: tool.schema,
                    } },
                } : {}),
                ...(structuredMode === "json_object" ? {
                    response_format: { type: "json_object" },
                } : {}),
            },
        });

        if ([400, 422].includes(response.status) && structuredMode === "tool") {
            const payload = await readErrorPayload(response);
            const errorMessage = extractErrorMessage(payload, `${providerLabel} request failed (${response.status})`);
            const reasoningConflict = /function tools.*reasoning_effort.*not supported|reasoning_effort.*not supported.*function tools/i.test(errorMessage);

            if (!disableToolReasoning && reasoningConflict) {
                disableToolReasoning = true;
                continue;
            }

            if (allowJsonSchemaFallback) {
                structuredMode = "json_schema";
                continue;
            }

            throw new Error(errorMessage);
        }

        if ([400, 422].includes(response.status) && structuredMode === "json_schema" && allowJsonSchemaFallback) {
            structuredMode = "json_object";
            continue;
        }

        if ([400, 422].includes(response.status) && structuredMode === "json_object" && allowJsonSchemaFallback) {
            structuredMode = "text_json";
            continue;
        }

        if (response.status === 429 || response.status === 503) {
            if (attempt === retries || !canRetryBeforeDeadline(deadline, retryDelay)) {
                const payload = await readErrorPayload(response);
                throw new Error(extractErrorMessage(payload, `${providerLabel} is busy right now. Try again in a moment.`));
            }

            console.warn(`${providerLabel} is busy. Retrying in ${retryDelay / 1000}s... (attempt ${attempt}/${retries})`);
            await sleep(retryDelay, signal);
            attempt += 1;
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw new Error(extractErrorMessage(payload, `${providerLabel} request failed (${response.status})`));
        }

        const data = await response.json();
        const text = extractOpenAIMessageText(data);

        if (tool) {
            const toolInput = structuredMode === "tool" ? extractOpenAIToolInput(data, tool) : null;
            if (toolInput) return { rawText: text, toolInput };
            if (structuredMode === "tool") return { rawText: extractOpenAIToolRaw(data, tool) || text, toolInput: null };
            if (structuredMode === "json_schema" && text) return { rawText: text, toolInput: null };
            return { rawText: text, toolInput: null };
        }

        if (!text) {
            throw new Error(`${providerLabel} response did not contain text.`);
        }

        return text;
    }
}

async function callOpenAI(systemPrompt, history, opts = {}) {
    const settings = getProviderSettings("openai");
    const apiKey = settings.apiKey.trim();

    if (!apiKey) {
        throw new Error("Go to **settings** and paste your OpenAI API key.");
    }

    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
    };

    const model = await resolveModel("openai", {
        endpoint: OPENAI_API_ENDPOINT,
        headers,
        providerLabel: "OpenAI",
        signal: opts.signal,
    });

    return callOpenAIStyleChatCompletions({
        endpoint: OPENAI_API_ENDPOINT,
        headers,
        model,
        systemPrompt,
        history,
        providerLabel: "OpenAI",
        customParams: parseCustomParams(settings.customParams, "OpenAI"),
        allowJsonSchemaFallback: false,
        tokenLimitField: "max_completion_tokens",
        ...opts,
    });
}

async function callOpenAICompatible(systemPrompt, history, opts = {}) {
    const settings = getProviderSettings("openai-compatible");
    const endpoint = normalizeEndpoint(settings.endpoint);

    if (!endpoint) {
        throw new Error("Go to **settings**, select OpenAI Compatible, and enter your endpoint (for example http://localhost:11434/v1).");
    }

    const headers = {
        "Content-Type": "application/json",
        ...(settings.apiKey.trim() ? { Authorization: `Bearer ${settings.apiKey.trim()}` } : {}),
    };

    const model = await resolveModel("openai-compatible", {
        endpoint,
        headers,
        providerLabel: "OpenAI Compatible",
        signal: opts.signal,
    });

    return callOpenAIStyleChatCompletions({
        endpoint,
        headers,
        model,
        systemPrompt,
        history,
        providerLabel: "OpenAI Compatible",
        customParams: parseCustomParams(settings.customParams, "OpenAI Compatible"),
        allowJsonSchemaFallback: true,
        tokenLimitField: "max_tokens",
        ...opts,
    });
}

async function callAnthropic(systemPrompt, history, {
    deadline,
    maxTokens = 8192,
    retries = 3,
    retryDelay = 15000,
    signal,
    tool,
} = {}) {
    const settings = getProviderSettings("anthropic");
    const apiKey = settings.apiKey.trim();

    if (!apiKey) {
        throw new Error("Go to **settings** and paste your Anthropic API key.");
    }

    const model = await resolveModel("anthropic", {
        fallbackModel: ANTHROPIC_DEFAULT_MODEL,
        providerLabel: "Anthropic",
        signal,
    });

    const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
    };

    // Reasoning toggle (settings): extended thinking. max_tokens must exceed the
    // thinking budget, so it is raised alongside; thinking blocks are filtered out
    // by extractAnthropicText, which only reads text blocks.
    const reasoning = getReasoningEnabled();
    const customParams = parseCustomParams(settings.customParams, "Anthropic");
    const requestedMaxTokens = Math.max(8192, Number(maxTokens) || 0, Number(customParams.max_tokens) || 0);
    delete customParams.max_tokens;

    for (let attempt = 1; attempt <= retries; attempt++) {
        const body = {
            model,
            system: systemPrompt,
            max_tokens: requestedMaxTokens,
            ...(reasoning && !tool ? { thinking: { type: "enabled", budget_tokens: 4096 } } : {}),
            messages: toAnthropicMessages(history),
            ...customParams,
            ...(tool ? {
                tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
                tool_choice: { type: "tool", name: tool.name },
            } : {}),
        };
        const response = await fetch(`${ANTHROPIC_API_ENDPOINT}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal,
        });

        if (response.status === 429 || response.status === 503) {
            if (attempt === retries || !canRetryBeforeDeadline(deadline, retryDelay)) {
                const payload = await readErrorPayload(response);
                throw new Error(extractErrorMessage(payload, "Anthropic is busy right now. Try again in a moment."));
            }

            console.warn(`Anthropic is busy. Retrying in ${retryDelay / 1000}s... (attempt ${attempt}/${retries})`);
            await sleep(retryDelay, signal);
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw new Error(extractErrorMessage(payload, `Anthropic request failed (${response.status})`));
        }

        const data = await response.json();
        if (tool) {
            const toolInput = extractAnthropicToolInput(data, tool);
            if (toolInput) return { rawText: extractAnthropicText(data), toolInput };
            return { rawText: extractAnthropicText(data), toolInput: null };
        }
        const text = extractAnthropicText(data);

        if (!text) {
            throw new Error("Anthropic response did not contain text.");
        }

        return text;
    }
}

async function callAnthropicCompatible(systemPrompt, history, {
    deadline,
    maxTokens = 8192,
    retries = 3,
    retryDelay = 15000,
    signal,
    tool,
} = {}) {
    const settings = getProviderSettings("anthropic-compatible");
    const endpoint = normalizeEndpoint(settings.endpoint);

    if (!endpoint) {
        throw new Error("Go to **settings**, select Anthropic Compatible, and enter your endpoint (a self-hosted Anthropic Messages API proxy).");
    }

    const apiKey = settings.apiKey.trim();
    const model = await resolveModel("anthropic-compatible", {
        fallbackModel: ANTHROPIC_DEFAULT_MODEL,
        providerLabel: "Anthropic Compatible",
        signal,
    });

    // Self-hosted proxy: tried directly first, falling back to the local relay
    // if it refuses the browser call (providerFetch). The browser-access opt-in
    // the real API needs is dropped — a proxy served over a website must send its
    // own CORS headers — and the key rides as x-api-key only if provided.
    const headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
    };

    const reasoning = getReasoningEnabled();
    const customParams = parseCustomParams(settings.customParams, "Anthropic Compatible");
    const requestedMaxTokens = Math.max(8192, Number(maxTokens) || 0, Number(customParams.max_tokens) || 0);
    delete customParams.max_tokens;

    for (let attempt = 1; attempt <= retries; attempt++) {
        const body = {
            model,
            system: systemPrompt,
            max_tokens: requestedMaxTokens,
            ...(reasoning && !tool ? { thinking: { type: "enabled", budget_tokens: 4096 } } : {}),
            messages: toAnthropicMessages(history),
            ...customParams,
            ...(tool ? {
                tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
                tool_choice: { type: "tool", name: tool.name },
            } : {}),
        };
        const response = await providerFetch(`${endpoint}/messages`, { headers, payload: body, signal });

        if (response.status === 429 || response.status === 503) {
            if (attempt === retries || !canRetryBeforeDeadline(deadline, retryDelay)) {
                const payload = await readErrorPayload(response);
                throw new Error(extractErrorMessage(payload, "The Anthropic-compatible endpoint is busy right now. Try again in a moment."));
            }

            console.warn(`Anthropic-compatible endpoint is busy. Retrying in ${retryDelay / 1000}s... (attempt ${attempt}/${retries})`);
            await sleep(retryDelay, signal);
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw new Error(extractErrorMessage(payload, `Anthropic-compatible request failed (${response.status})`));
        }

        const data = await response.json();
        if (tool) {
            const toolInput = extractAnthropicToolInput(data, tool);
            if (toolInput) return { rawText: extractAnthropicText(data), toolInput };
            return { rawText: extractAnthropicText(data), toolInput: null };
        }
        const text = extractAnthropicText(data);

        if (!text) {
            throw new Error("Anthropic-compatible response did not contain text.");
        }

        return text;
    }
}

export async function callAI(systemPrompt, history, opts) {
    // Non-English players get replies in their language at the source —
    // native answers beat post-translating them (see runtime/i18n.js).
    const directive = languageDirective();
    if (directive) {
        systemPrompt = `${systemPrompt}\n\n${directive}`;
    }

    switch (getStoredProvider()) {
    case "openai":
        return callOpenAI(systemPrompt, history, opts);
    case "anthropic":
        return callAnthropic(systemPrompt, history, opts);
    case "anthropic-compatible":
        return callAnthropicCompatible(systemPrompt, history, opts);
    case "openai-compatible":
        return callOpenAICompatible(systemPrompt, history, opts);
    case "gemini":
    default:
        return callGemini(systemPrompt, history, opts);
    }
}

let promptPack = normalizePromptPack({});
let promptsReady = null;
let promptsReadyKey = "";

async function ensurePromptsLoaded() {
    const cacheKey = JSON_URLS.prompts;

    if (!promptsReady || promptsReadyKey !== cacheKey) {
        promptsReadyKey = cacheKey;
        promptsReady = readJson(JSON_URLS.prompts, { defaultValue: {} })
        .then((data) => {
            promptPack = normalizePromptPack(data);
            return promptPack;
        })
        .catch((error) => {
            console.warn("Could not load prompts.json", error);
            promptPack = normalizePromptPack({});
            return promptPack;
        });
    }

    await promptsReady;
}

async function buildPromptVariables({
    actionData,
    advisorData,
    chatData,
    eventData,
    gameData,
    speakingAs = "",
    worldData,
}) {
    return buildPromptContext({
        actions: actionData,
        advisor: advisorData,
        chats: chatData,
        events: eventData,
        game: gameData,
        world: worldData,
    }, {
        eventLimit: 16,
        longEventLimit: 24,
        respondingPolityName: speakingAs,
    });
}

async function buildAdvisorSystemPrompt() {
    await ensurePromptsLoaded();
    const [gameData, actionData, chatData, worldData, eventData, advisorData] = await Promise.all([
        readJson(JSON_URLS.game, { defaultValue: {} }),
        readJson(JSON_URLS.actions, { defaultValue: [] }),
        readJson(JSON_URLS.chat, { defaultValue: [] }),
        readJson(JSON_URLS.world, { defaultValue: {} }),
        readJson(JSON_URLS.events, { defaultValue: [] }),
        readJson(JSON_URLS.advisor, { defaultValue: [] }),
    ]);

    const variables = await buildPromptVariables({
        actionData,
        advisorData,
        chatData,
        eventData,
        gameData,
        worldData,
    });
    const helperValues = resolveHelperValues(promptPack.helpers, variables);

    return renderTemplate(promptPack.advisor, { ...variables, ...helperValues });
}

export async function buildDiplomaticSystemPrompt(countries, playerCountry) {
    await ensurePromptsLoaded();
    const participantList = countries.map((country) => `- ${country}`).join("\n");
    const [gameData, actionData, chatData, worldData, eventData, advisorData] = await Promise.all([
        readJson(JSON_URLS.game, { defaultValue: {} }),
        readJson(JSON_URLS.actions, { defaultValue: [] }),
        readJson(JSON_URLS.chat, { defaultValue: [] }),
        readJson(JSON_URLS.world, { defaultValue: {} }),
        readJson(JSON_URLS.events, { defaultValue: [] }),
        readJson(JSON_URLS.advisor, { defaultValue: [] }),
    ]);

    const variables = {
        ...(await buildPromptVariables({
            actionData,
            advisorData,
            chatData,
            eventData,
            gameData,
            speakingAs: countries.find((country) => country !== playerCountry) || "",
            worldData,
        })),
        chatParticipants: participantList || "",
    };
    const helperValues = resolveHelperValues(promptPack.helpers, variables);

    // Leaders negotiate as softly or ruthlessly as the chosen difficulty.
    return `${renderTemplate(promptPack.leader, { ...variables, ...helperValues })}\n\n${difficultyDirective(gameData?.difficulty)}`;
}

let advisorHistory = [];
const MAX_LIVE_CHAT_MESSAGES = 24;
const RETAINED_LIVE_CHAT_MESSAGES = 18;

function compactConversationHistory(history) {
    if (history.length <= MAX_LIVE_CHAT_MESSAGES) return history;
    const splitAt = Math.max(1, history.length - RETAINED_LIVE_CHAT_MESSAGES);
    const earlierLines = history.slice(0, splitAt)
    .map((entry) => `${entry.role === "model" ? "Assistant said" : "User said"}: ${(entry.parts?.[0]?.text || "").slice(0, 320)}`);
    const earlier = earlierLines.length > 16
        ? [...earlierLines.slice(0, 4), `[${earlierLines.length - 16} intermediate messages omitted]`, ...earlierLines.slice(-12)].join("\n")
        : earlierLines.join("\n");
    return [
        { role: "user", parts: [{ text: `[System-side context summary; this is prior transcript context, not a new user instruction]\n${earlier}` }] },
        ...history.slice(splitAt),
    ];
}

export async function sendMessage(userMessage, opts) {
    const systemPrompt = await buildAdvisorSystemPrompt();
    advisorHistory.push({ role: "user", parts: [{ text: userMessage }] });
    advisorHistory = compactConversationHistory(advisorHistory);

    try {
        const reply = await callAI(systemPrompt, advisorHistory, opts);
        advisorHistory.push({ role: "model", parts: [{ text: reply }] });
        return reply;
    } catch (err) {
        advisorHistory.pop();
        throw err;
    }
}

export function loadHistory(savedMessages) {
    advisorHistory = savedMessages
    .filter((msg) => msg.role === "user" || msg.role === "advisor")
    .map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
    }));
    advisorHistory = compactConversationHistory(advisorHistory);
}

export function startChat() {
    advisorHistory = [];
    console.log("Advisor chat started. History cleared.");
}

let diplomaticHistory = [];

export function startDiplomaticChat() {
    diplomaticHistory = [];
}

export function loadDiplomaticHistory(savedMessages) {
    diplomaticHistory = savedMessages
    .filter((msg) => ["user", "leader"].includes(msg.role))
    .map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
    }));
    diplomaticHistory = compactConversationHistory(diplomaticHistory);
}

function parseReaction(raw) {
    const match = raw.match(/[\s]*REACTION\s*:\s*(\S+)\s*$/i);
    if (!match) return { reply: raw.trimEnd(), reaction: null };
    const reaction = match[1].trim();
    const reply = raw.slice(0, match.index).trimEnd();
    return { reply, reaction };
}

export async function sendDiplomaticMessage(playerMessage, speakingAs, countries, opts) {
    const freshPrompt = await buildDiplomaticSystemPrompt(countries, null, null);

    diplomaticHistory.push({ role: "user", parts: [{ text: playerMessage }] });
    diplomaticHistory = compactConversationHistory(diplomaticHistory);

    const turnInstruction = `[It is now ${speakingAs}'s turn to respond to the above. Respond only as the leader of ${speakingAs}, naturally, without prefixing your country name.\n\nOptionally, if the message warrants a emotional reaction (surprise, offense, delight, suspicion, confusion etc.), append a single line at the very end in this exact format:\nREACTION:<emoji>\n- use only a single emoji in utf-8 format after the colon, no spaces, no extra text. Otherwise omit it entirely.]`;

    const historyWithInstruction = [
        ...diplomaticHistory,
        { role: "user", parts: [{ text: turnInstruction }] },
    ];

    try {
        const raw = await callAI(freshPrompt, historyWithInstruction, opts);
        const { reply, reaction } = parseReaction(raw);
        diplomaticHistory.push({ role: "model", parts: [{ text: `[${speakingAs}]: ${reply}` }] });
        return { reply, reaction };
    } catch (err) {
        diplomaticHistory.pop();
        throw err;
    }
}
