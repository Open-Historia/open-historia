/*! Open Historia — portions (server relay for OpenAI-style APIs + reasoning toggle) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import {
    GEMINI_DEFAULT_CHAIN,
    OPENAI_DEFAULT_MODEL,
    fallbackStateStore,
    getEntryStatus,
    getRateLimitPolicy,
    getReasoningEnabled,
    getResolvedFallbackList,
    resolveTaskFallbackEntries,
    providerSupportsModelDiscovery,
    saveRecentModel,
    updateEntry,
} from "./providerConfig.js";
import { formatResetTime, runWithFallback } from "./fallbackRunner.js";
import { polityRoleOf } from "../../../server/polityRole.js";
import { BACKGROUND_REQUEST, PLAYER_REQUEST, requestLedger } from "./requestBudget.js";
import {
    DEFAULT_ANSWER_RESERVE_TOKENS,
    contextWindowKey,
    createContextWindowMemory,
    estimateTokens,
    nothingFitsMessage,
    parseContextWindowError,
    requestChars,
} from "./contextWindow.js";
import { splitSystemPromptForCache } from "./promptLayout.js";
import { looksLikeModelFilePath, resolveServedModelId } from "./modelIds.js";
import { attachLookupRound, attachCallMetrics, finishAiRecord, isTelemetryEnabled, startAiRecord  } from "./telemetry.js";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { describePuppetBriefing, describeRole, livePuppetsFor, puppetBriefingFor, puppetStatesEnabled } from "../../runtime/puppets.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import {
  buildDiplomaticTurnInstruction,
  diplomaticMemoryContextEntry,
  formatDiplomaticTranscriptEntry,
  latestSavedDiplomaticMemory,
  parseDiplomaticEnvelope,
} from "../../runtime/diplomaticEnvelope.js";
import { chatLanguageDirective, languageDirective } from "../../runtime/i18n.js";
import { difficultyDirective } from "../../runtime/difficulty.js";
import { normalizePromptPack } from "./gameplayPrompts.js";
import { promptTranslationsVersion } from "../../runtime/promptTranslations.js";
import {
    busyProviderMessage,
    classifyProviderFailure,
    contextWindowMessage,
    describeHtmlErrorPage,
    errorPayloadText,
    isBusyErrorPayload,
    isContextWindowErrorPayload,
    isContextWindowErrorText,
    isStreamingRefusal,
    isStreamingRequired,
    isTemperatureRefusal,
    looksLikeDeliberation,
    providerErrorReplyMessage,
    shouldRetryProviderFailure,
    TOOL_CALL_INSISTENCE,
    toolStreamRefusalError,
} from "./providerErrors.js";
import { ANSWER_SENTINEL_DIRECTIVE } from "./jsonSalvage.js";
import { createModeObserver, nextStructuredMode, startingStructuredMode } from "./structuredMode.js";
import { createTemperatureMemory, temperatureBody, temperatureRefusalKey } from "./sampling.js";
import { nativeHttpAvailable, nativeHttpFetch } from "../../runtime/native/http.js";
import { createFirstByteTimer, normalizeUsage, sumUsage } from "./usageStats.js";
import { toGeminiSchema } from "./geminiSchema.js";
import { readAnthropicStreamedResponse, readGeminiStreamedResponse, readOpenAIStreamedResponse } from "./streamAssembly.js";
import {
    anthropicMessagesFromHistory,
    appendLookupRound,
    describeLookupCall,
    geminiContentsFromHistory,
    lookupCallsFromAnthropic,
    lookupCallsFromGemini,
    lookupCallsFromOpenAI,
    lookupRoundCount,
    openAiMessagesFromHistory,
} from "./toolTurns.js";
import {
    buildPromptContext,
    formatDateReadable,
    renderTemplate,
    resolveHelperValues,
} from "./promptContext.js";
import { collapseRepeatedWorldContext } from "./promptDedupe.js";
import { filterChatsVisibleTo, isChatVisibleTo } from "./chatVisibility.js";
import { foreignAgentBrief, intelligenceOf } from "../../runtime/spycraft.js";
import { describeCountryStatsForAdvisor, normalizeCountryStatsHistory } from "../../runtime/countryStats.js";
import { describeWorldLedgersForAdvisor, polityEntry } from "./advisorLedgers.js";
import { loadStatSheetDefinition } from "../../runtime/statsSheet.js";
import { renderReminders } from "../../runtime/gmChanges.js";
import { describeGoalForAdvisor, playerGoalOf } from "../../runtime/playerGoal.js";
import { describeReportsForPrompt, normalizeReports } from "../../runtime/reports.js";
import { describeDocumentsForAdvisor } from "../../runtime/reportDelivery.js";
import { viewAsSeen } from "../../runtime/gameState.js";
import { withCatchUp } from "./conversationCatchUp.js";
import { buildDiplomaticPoliticalContext } from "./diplomaticPoliticalContext.js";
import { buildAdvisorPoliticalDiplomacyContext } from "./advisorPoliticalDiplomacyContext.js";
import { beginAiRequestScope } from "./aiRequestControl.js";

// main.jsx - AI chat module
// Supports Gemini, OpenAI, Anthropic, and OpenAI-compatible endpoints
// Usage: import { sendMessage, sendDiplomaticMessage, startChat, startDiplomaticChat, loadHistory, loadDiplomaticHistory, buildDiplomaticSystemPrompt } from './main.jsx'

// An entry with a blank model: the top of Gemini's default list (providerConfig.js).
const GEMINI_DEFAULT_MODEL = GEMINI_DEFAULT_CHAIN[0];
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";

// What each model has said about its context window (contextWindow.js), kept
// with the other AI settings. Storage is reached at every call rather than
// once: the harness installs its localStorage after this module has loaded,
// and a browser that refuses storage simply forgets between sessions.
const settingsStorage = {
    getItem: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
    setItem: (key, value) => { try { localStorage.setItem(key, value); } catch { /* this session only */ } },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch { /* nothing to forget */ } },
};
export const contextWindows = createContextWindowMemory(settingsStorage);
export const temperatureRefusals = createTemperatureMemory(settingsStorage);
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
    if (typeof payload === "string" && payload.trim()) return describeHtmlErrorPage(payload, fallback) || payload.trim();
    if (payload.error?.message) return payload.error.message;
    if (payload.message) return payload.message;
    if (typeof payload.rawText === "string" && payload.rawText.trim()) {
        return describeHtmlErrorPage(payload.rawText, fallback) || payload.rawText.trim();
    }
    return fallback;
}

// The body of a reply that claimed success. A 200 carrying a web page (a gateway
// landing page, a proxy's error screen) used to surface as JSON.parse's
// "Unexpected token '<', "<!doctype "... is not valid JSON" — true, and no help.
async function readJsonAnswer(response, providerLabel) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (error) {
        const page = describeHtmlErrorPage(text, `${providerLabel} request failed (${response.status})`);
        if (page) throw new Error(page);
        throw error;
    }
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

// Qwen/DeepSeek thinking models emit reasoning either in a separate field or inline in
// <think>...</think>. Strip the think block so we return the actual answer; an unclosed
// <think> means the stream was cut mid-thought, leaving no answer, so drop it too.
function stripThinking(value) {
    if (typeof value !== "string") return "";
    let out = value.replace(/<think>[\s\S]*?<\/think>/gi, "");
    const open = out.search(/<think>/i);
    if (open !== -1) out = out.slice(0, open);
    return out.trim();
}

function extractOpenAIMessageText(data) {
    const message = data?.choices?.[0]?.message;
    const raw = message?.content;
    let text = "";

    if (typeof raw === "string") {
        text = raw;
    } else if (Array.isArray(raw)) {
        text = raw
        .map((part) => {
            if (typeof part === "string") return part;
            if (typeof part?.text === "string") return part.text;
            return "";
        })
        .join("");
    }

    text = stripThinking(text);
    // All reasoning, no answer (#540): fall back to the reasoning text rather than error.
    if (!text) text = stripThinking(message?.reasoning);
    return text;
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

function getGeminiUrl(model, apiKey) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
}

// The same call as an event stream. Used for the advisor (tokens to the UI) and
// for tool calls (keep-alive) — see the streaming comment in callGemini.
function getGeminiStreamUrl(model, apiKey) {
    return getGeminiUrl(model, apiKey).replace(":generateContent?", ":streamGenerateContent?alt=sse&");
}

// Why a Gemini skip's events arrive together while every other provider's arrive
// one by one (streamedEvents.js).
//
// Streaming a tool call's arguments needs partialArgs, and
// toolConfig.functionCallingConfig.streamFunctionCallArguments is Vertex-only:
// this API's v1beta discovery doc (revision 20260918) gives FunctionCallingConfig
// only `mode` and `allowedFunctionNames`. Sending it buys a 400 and costs the
// player a request, so it is not sent.
//
// The alternative, JSON mode, does stream but Gemini refuses it alongside tools
// ("Function calling with a response mime type: 'application/json' is
// unsupported"), so a skip would lose its lookup functions. Declined: the
// simulator keeps the ability to ask the engine questions.
//
// streamAssembly.js still assembles partialArgs if they ever arrive, so the day
// the field reaches this API, asking for it is the only change.

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

// What the structured-output ladder has learned about the endpoints in use this
// session (structuredMode.js). Session-scoped on purpose: it is an observation
// about how a gateway behaved just now, not a setting — the SETTING is the thing
// the player is offered once the evidence is consistent, and only they can
// change it.
const structuredModeObserver = createModeObserver();

// A call that started at one rung and succeeded lower down. Only a genuine drop
// teaches anything; succeeding where it began is the expected case.
function noteStructuredModeLanding(key, startedAt, landedAt, configured) {
    if (!key) return;
    const seen = structuredModeObserver.record(key, startedAt, landedAt);
    if (!seen) return;
    logDebugEvent("ai", `Structured output fell back to ${landedAt} for ${key}.`, {
        startedAt,
        timesSeen: seen.count,
    }, { verbose: true });
    // Announced, not acted on. The UI decides whether and how to ask; nothing
    // changes until the player says so.
    if (structuredModeObserver.shouldSuggest(key, configured)) {
        try {
            window.dispatchEvent(new CustomEvent("ai:structured-mode-suggestion", {
                detail: { key, mode: landedAt },
            }));
        } catch { /* no window (tests, workers) — the observation still stands */ }
    }
}

// Asked by the UI when it wants to know whether there is anything to offer.
// The evidence is kept per Fallback entry — the id is the observer's key — so
// the first entry with something to offer is the one asked about.
export const getStructuredModeSuggestion = () => {
    for (const entry of getResolvedFallbackList()) {
        const mode = structuredModeObserver.shouldSuggest(entry.id, entry.structuredMode);
        if (mode) return { key: entry.id, mode, label: entry.label };
    }
    return null;
};

// "No thanks" — remembered for the session so it does not ask again every turn.
export const declineStructuredModeSuggestion = (key, mode) => {
    structuredModeObserver.decline(key, mode);
};

// "Yes" — write the setting on that entry, then forget the evidence so a later
// change in the endpoint's behaviour is learned fresh rather than judged
// against stale data.
export const acceptStructuredModeSuggestion = (key, mode) => {
    updateEntry(key, { structuredMode: mode });
    structuredModeObserver.clear(key);
    logDebugEvent("ai", `Structured output set to ${mode} for a Fallback entry.`, { key });
};

const PAGE_IS_LOCAL = isLocallyServed();
// The Android app: no server and so no relay, but Capacitor's HTTP plugin makes
// a request from the app process, where CORS does not exist. It stands in for
// the relay for the same endpoints — a model on the LAN — with one difference
// the caller can see: the reply arrives whole, not streamed (native/http.js).
const NATIVE_HTTP = Boolean(import.meta.env.VITE_OH_NATIVE) && nativeHttpAvailable();// Endpoints that have already proven they need the relay (no browser CORS) —
// remembered so we skip the doomed direct attempt on every later call.
const relayOnlyOrigins = new Set();

function endpointOrigin(url) {
    try {
        return new URL(url, typeof window !== "undefined" ? window.location.href : undefined).origin;
    } catch {
        return url;
    }
}

// True when the endpoint lives on the player's own machine or LAN (Ollama, LM
// Studio, a home gateway). Such a backend IS reachable from a hosted https page —
// the fetch starts in the player's own browser, and neither mixed content nor
// Private Network Access blocks it — but the browser discards the reply unless the
// backend echoes an Access-Control-Allow-Origin for this site. Stock Ollama does
// not, which is the whole reason a local model appears "broken" on the website.
function isLocalEndpoint(url) {
    try {
        const host = new URL(url, typeof window !== "undefined" ? window.location.href : undefined).hostname;
        if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
        if (host.endsWith(".local")) return true;
        if (/^127\./.test(host)) return true;
        if (/^10\./.test(host)) return true;
        if (/^192\.168\./.test(host)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
        return false;
    } catch {
        return false;
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
    // In the app, a backend on the player's own network goes native first: stock
    // Ollama and LM Studio send no CORS headers, so the direct attempt is doomed
    // and would only cost the request. Anything else proves it first.
    if (NATIVE_HTTP && (relayOnlyOrigins.has(origin) || isLocalEndpoint(url))) {
        return nativeHttpFetch(url, options);
    }
    try {
        return await directFetch(url, options);
    } catch (error) {
        const aborted = options.signal?.aborted || error?.name === "AbortError";
        if (PAGE_IS_LOCAL && !aborted && error instanceof TypeError) {
            relayOnlyOrigins.add(origin);
            return relayFetch(url, options);
        }
        if (NATIVE_HTTP && !aborted && error instanceof TypeError) {
            relayOnlyOrigins.add(origin);
            return nativeHttpFetch(url, options);
        }
        // Hosted page, local backend, and the browser rejected the reply: this is
        // almost always the backend not allowing this origin, and "Failed to fetch"
        // is indistinguishable from the network being down. Say what to actually do.
        if (!PAGE_IS_LOCAL && !aborted && error instanceof TypeError && isLocalEndpoint(url)) {
            const site = typeof window !== "undefined" ? window.location.origin : "this site";
            throw new Error(
                `${origin} refused the browser's request. A local AI server has to allow this site's ` +
                `origin before ${site} can use it: restart Ollama with OLLAMA_ORIGINS=${site} ` +
                `(LM Studio: turn on CORS in its server settings), then try again. ` +
                `The desktop app needs no such setup.`,
            );
        }
        throw error;
    }
}

// Generic SSE text streamer for the CHAT path (the advisor). Reads `data:` lines,
// pulls each provider's incremental text via extractDelta, forwards it to
// onChunk(delta, fullSoFar), and returns the full accumulated text. Used ONLY
// for non-tool calls that pass an onChunk callback; tool/JSON tasks keep the
// buffered path so the whole structured object is still parsed at once. The
// onChunk call is wrapped so a throwing UI callback can never break the stream.
// Returns { text, reasoning }: the streamed ANSWER, and separately whatever the
// model streamed as chain of thought.
//
// Reasoning is fully supported and completely excluded from the reply — the same
// contract the Anthropic path has always had ("thinking blocks are filtered out
// by extractAnthropicText, which only reads text blocks"). It is returned only so
// the caller can tell "the model thought but never answered" from "the model
// returned nothing at all", which are different problems with different fixes.
// What to tell the player when a provider returns nothing at all.
//
// By this point the all-reasoning case has already been retried once with the
// token cap lifted, so reaching here means the model produced no answer even
// with room to think — a model or endpoint problem, not a setting to toggle.
// Deliberately does NOT suggest turning reasoning off: reasoning is supported,
// and the answer is to give it room, which the retry already did.
// Builds the error the advisor shows AND the debug report behind its Copy
// button. The message alone was never enough to act on: the interesting part is
// what the provider actually sent, which is otherwise discarded the moment the
// stream ends.
//
// The API key and the endpoint host are never included — those come from
// headers and settings, and nothing here reads them. What IS included is model
// output: the tail of the chain of thought and a few raw stream frames, because
// without them an unfamiliar gateway's shape cannot be diagnosed at all. That
// output can quote the campaign, so the UI warns before it is shared.
function aiFailureError(message, diagnostics) {
    const error = new Error(message);
    error.diagnostics = diagnostics;
    return error;
}

function emptyReplyMessage(providerLabel) {
    return `${providerLabel} returned no answer, even after being given more room to think. `
        + `The model may be out of context, or the endpoint may have dropped the response. `
        + `Try sending a shorter message, or check the model is loaded and healthy.`;
}

// errorPayloadText / isBusyErrorPayload / busyProviderMessage /
// providerErrorReplyMessage live in providerErrors.js (imported at the top of
// this file) so they can be unit-tested: nothing in main.jsx can be, and
// deciding whether a provider is merely busy is exactly the kind of string
// handling that needs to be. See that file for why it exists at all.

// The error every streaming path throws when the stream ended with no answer.
// If the provider said why, say what it said; otherwise fall back to the
// caller's own wording. Written once because all four streaming call sites had
// the same blind spot — Anthropic's overloaded_error and Gemini's UNAVAILABLE
// arrive exactly like the OpenAI-compatible one above, inside the stream.
function streamFailureError(providerLabel, streamResult, { retried = false, fallbackMessage } = {}) {
    const detail = errorPayloadText(streamResult.streamError);
    const busy = isBusyErrorPayload(streamResult.streamError);
    const error = aiFailureError(
        streamResult.streamError
            ? (busy ? busyProviderMessage(providerLabel, detail, retried) : providerErrorReplyMessage(providerLabel, detail))
            : fallbackMessage,
        {
            provider: providerLabel,
            mode: "streaming chat",
            ...(streamResult.streamError ? { providerError: detail || "(no message)", retriedAfterOverload: retried } : {}),
            finishReason: streamResult.finishReason || "(none reported)",
            streamFrames: streamResult.frames,
            sampleFrames: streamResult.sample,
        },
    );
    // The provider's own refusal says whether another Fallback entry is worth
    // asking; a stream that simply came back empty does not.
    if (streamResult.streamError) error.providerFailure = classifyProviderFailure({ payload: streamResult.streamError });
    return error;
}

// One retry, five seconds later. Long enough for a load spike to pass, short
// enough that the player is not left watching the dots — and capped at one, so a
// provider that is genuinely down fails with a real message and a Retry button
// rather than stalling the turn.
const OVERLOADED_RETRY_DELAY = 5000;

// Transient gateway failures worth another go. 502 and 504 are here because a
// proxy or edge having a bad moment is exactly as temporary as a 503, and
// providerErrors.js has ALWAYS treated all four as "busy" when they arrive
// inside a stream — this just makes the HTTP status agree with the stream frame.
// Without it a 502 threw immediately while an identical 502 delivered as a frame
// got three attempts, and a single gateway hiccup cost a chat reply or a turn.
// 529 is Anthropic's own status for overloaded_error, the same thing again.
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504, 529]);

// One of the statuses above: wait and go round again, or throw an error that
// says why, for the Fallback list. A spent quota never retries — every
// provider but Gemini used to retry it three times, OpenAI's insufficient_quota
// included — and how often busy and Rate limited retry is the list's rule
// (shouldRetryProviderFailure), so every provider path agrees. Gemini has its
// own (callGemini), because its messages name its quotas.
async function retryOrFailByStatus(response, { attempt, retries, retryDelay, deadline, signal, canFallBack, rateLimitPolicy, providerLabel }) {
    const payload = await readErrorPayload(response);
    const failure = classifyProviderFailure({ status: response.status, payload });
    const details = extractErrorMessage(payload, "");
    if (failure.kind === "spent") {
        throw providerFailureError(`${providerLabel} says the quota or balance on this key is used up. ${details}`.trim(), failure);
    }
    const wait = failure.kind === "rateLimited" ? (failure.waitMs ?? retryDelay) : retryDelay;
    if (!shouldRetryProviderFailure({ failure, attempt, retries, canFallBack, rateLimitPolicy }) || !canRetryBeforeDeadline(deadline, wait)) {
        const message = failure.kind === "rateLimited"
            ? `${providerLabel} is rate limiting this key after ${attempt} attempt${attempt === 1 ? "" : "s"}. ${details}`.trim()
            : extractErrorMessage(payload, `${providerLabel} is busy right now. Try again in a moment.`);
        throw providerFailureError(message, failure);
    }
    console.warn(`${providerLabel} ${failure.kind === "rateLimited" ? "is rate limiting" : "is busy"}. Retrying in ${wait / 1000}s... (attempt ${attempt}/${retries})`);
    await sleep(wait, signal);
}

async function streamTextSSE(response, extractDelta, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let reasoning = "";
    // Diagnostics for the failure case only. finish_reason is the single most
    // useful field when a reply comes back empty ("length" means it hit the
    // token cap mid-thought), and a sample of the raw frames is what makes an
    // unfamiliar gateway's shape debuggable at all — we cannot guess the field
    // names a new backend invents.
    let finishReason = "";
    let frames = 0;
    let streamError = null;
    const sample = [];
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                let json;
                try { json = JSON.parse(payload); } catch { continue; }
                frames += 1;
                // An error object in place of a delta: the provider gave up
                // mid-stream. Keep the FIRST one — it is the cause; anything
                // after it is fallout.
                if (!streamError && json?.error) streamError = json.error;
                if (json?.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
                // Keep the first few frames and nothing more: enough to show the
                // shape a gateway is using, small enough to paste into a report.
                if (sample.length < 3) sample.push(payload.slice(0, 400));
                // An extractor may return a plain string (content only) or
                // { content, reasoning } — the providers that separate the two.
                const delta = extractDelta(json);
                const contentDelta = typeof delta === "string" ? delta : (delta?.content ?? "");
                const reasoningDelta = typeof delta === "string" ? "" : (delta?.reasoning ?? "");
                if (reasoningDelta) reasoning += reasoningDelta;
                if (contentDelta) { full += contentDelta; try { onChunk(contentDelta, full); } catch { /* UI callback must not break the stream */ } }
            }
        }
    } finally {
        try { reader.releaseLock(); } catch { /* already closed */ }
    }

    // Inline <think> blocks arrive as ordinary content, so the streamed preview
    // shows them; strip them from what is RETURNED, which is what gets persisted
    // and re-read on reload. An unclosed block means the stream was cut
    // mid-thought and there is no answer in there at all.
    return {
        text: stripThinking(full),
        reasoning: reasoning.trim(),
        finishReason,
        frames,
        streamError,
        sample,
    };
}

// One incremental text chunk per provider's stream event. NOTE: joinGeminiParts
// trims, which would swallow the leading space of each chunk and run words
// together — so join the streamed parts WITHOUT trimming.
const geminiStreamDelta = (json) =>
    (json?.candidates?.[0]?.content?.parts ?? []).map((part) => part?.text ?? "").join("");
// Thinking models (Qwen3, DeepSeek-R1, and the gateways in front of them) stream
// their chain of thought in a field beside content: `reasoning_content` is the
// DeepSeek/vLLM spelling, `reasoning` the OpenRouter one. Reading only `content`
// is what made an all-reasoning reply look like an empty one (#540).
const openaiStreamDelta = (json) => {
    const delta = json?.choices?.[0]?.delta;
    return {
        content: typeof delta?.content === "string" ? delta.content : "",
        reasoning: typeof delta?.reasoning_content === "string"
            ? delta.reasoning_content
            : (typeof delta?.reasoning === "string" ? delta.reasoning : ""),
    };
};
const anthropicStreamDelta = (json) => {
    if (json?.type !== "content_block_delta") return "";
    if (json?.delta?.type === "text_delta") return { content: json.delta.text || "", reasoning: "" };
    // Extended thinking arrives as its own delta type; keep it for the same
    // all-reasoning-no-answer fallback the OpenAI-compatible path gets.
    if (json?.delta?.type === "thinking_delta") return { content: "", reasoning: json.delta.thinking || "" };
    return "";
};

// The conversation is kept in Gemini's shape ({ role, parts }) and rendered per
// provider here. Text turns render as they always did; a lookup round (a model
// turn of functionCall parts answered by a user turn of functionResponse
// parts, toolTurns.js) renders as that provider's tool-call exchange.
function toOpenAIMessages(systemPrompt, history) {
    return openAiMessagesFromHistory(systemPrompt, history);
}

function toAnthropicMessages(history) {
    return anthropicMessagesFromHistory(history);
}

// An error that says how the call failed, for the Fallback list
// (fallbackRunner.js): Spent, Unusable, Rate limited, busy or other. Only the
// first four move a call to the next entry.
function providerFailureError(message, failure, extra = {}) {
    const error = Object.assign(new Error(message), extra);
    error.providerFailure = failure;
    return error;
}

// The same, for a response the provider refused outright: a request too big
// for the model's window gets the message that says so and names the fix
// (contextWindowMessage), whatever words the provider used.
const refusedRequestError = (providerLabel, message, failure, requestChars = 0) => providerFailureError(
    failure?.kind === "tooBig" ? contextWindowMessage(providerLabel, message, requestChars) : message,
    failure,
);

// Spent and Unusable: no retry, and none of a provider's own concessions
// (streaming off, a lower structured-output rung) can fix them either.
const waitingCannotFix = (failure) => failure.kind === "unusable" || failure.kind === "spent";

// A server the browser could not reach at all (a local model that is not
// running, the network down) is busy for the Fallback list: worth skipping for a
// minute, and worth trying again after. Matched on the browsers' own wording, so
// a TypeError from a bug in this file is never mistaken for one.
const UNREACHABLE_TEXT = /failed to fetch|fetch failed|networkerror|load failed|network request failed/i;
const isUnreachableError = (error) => error instanceof TypeError && UNREACHABLE_TEXT.test(String(error.message));

// An entry that is missing what its provider needs cannot answer until the
// player edits it — the same as a rejected key.
const missingSetupError = (message, reason) => providerFailureError(message, { kind: "unusable", reason });

// The model one call runs with: the Fallback entry's own (typed, or discovered
// below). Recorded afterwards so the model fields can suggest what was used.
async function resolveModel(provider, options = {}) {
    const model = await resolveConfiguredModel(provider, options);
    saveRecentModel(provider, model);
    return model;
}

// A model discovered from a server's /models list, per entry, for the session.
// Never written into the entry: a blank model means "whatever the server
// serves", and should keep meaning that when the server's list changes.
const discoveredModels = new Map(); // entry id -> model id

async function resolveConfiguredModel(provider, { entrySettings, endpoint = "", headers = {}, fallbackModel = "", providerLabel, signal } = {}) {
    const configuredModel = String(entrySettings?.model ?? "").trim();

    if (configuredModel) {
        if (provider === "gemini") return normalizeGeminiModel(configuredModel);
        return matchServedModel(provider, configuredModel, { endpoint, headers, providerLabel, signal });
    }

    if (fallbackModel) {
        return fallbackModel;
    }

    if (!providerSupportsModelDiscovery(provider)) {
        throw missingSetupError(`Go to **settings** and enter a model for ${providerLabel}.`, "no model set");
    }

    const normalizedEndpoint = normalizeEndpoint(endpoint);

    if (!normalizedEndpoint) {
        throw missingSetupError(`Go to **settings** and enter an endpoint for ${providerLabel}.`, "no endpoint set");
    }

    const cached = entrySettings?.id ? discoveredModels.get(entrySettings.id) : "";
    if (cached) return cached;

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
        if (entrySettings?.id) discoveredModels.set(entrySettings.id, discoveredModel);
        return discoveredModel;
    } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        console.warn(`Could not auto-detect model for ${providerLabel}:`, error);
        // A server that cannot be reached may come back; one that answers
        // with no models needs the player.
        throw providerFailureError(
            `Could not auto-detect a model for ${providerLabel}. Enter a model manually in **settings**.`,
            isUnreachableError(error) ? { kind: "busy", reason: "could not be reached" } : { kind: "unusable", reason: "no model found on the server" },
        );
    }
}

// Issue #721. A configured id that names a model FILE (see modelIds.js) is
// checked against the server's own /models list before it is sent: classic
// llama-server reports its -m path as the model id, the game remembers and
// suggests that id, and the same server in router mode only answers to the
// model's NAME. Exact matches win, so servers whose ids really are paths are
// untouched; with no list, or no match, the configured id goes out unchanged —
// exactly what happened before this existed. Every other id skips all of it.
//
// Cached per endpoint for a minute: one lookup covers a whole turn's worth of
// task calls rather than one per call, and a model the player loads into the
// router mid-session is picked up within the minute.
const SERVED_MODELS_TTL_MS = 60 * 1000;
const servedModelsCache = new Map(); // endpoint -> { at, ids }
// A turn makes many task calls; say it once per model, not on every one of them.
const warnedServedModels = new Set();
const warnServedModelOnce = (key, message) => {
    if (warnedServedModels.has(key)) return;
    warnedServedModels.add(key);
    console.warn(message);
};

async function listServedModelIds(endpoint, headers, signal) {
    const cached = servedModelsCache.get(endpoint);
    if (cached && Date.now() - cached.at < SERVED_MODELS_TTL_MS) return cached.ids;
    const response = await providerFetch(`${endpoint}/models`, { method: "GET", headers, signal });
    if (!response.ok) return null;
    const data = await response.json();
    const ids = (data?.data ?? [])
        .map((entry) => entry?.id)
        .filter((id) => typeof id === "string" && id.trim());
    servedModelsCache.set(endpoint, { at: Date.now(), ids });
    return ids;
}

async function matchServedModel(provider, configuredModel, { endpoint = "", headers = {}, providerLabel = provider, signal } = {}) {
    if (!providerSupportsModelDiscovery(provider) || !looksLikeModelFilePath(configuredModel)) return configuredModel;
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!normalizedEndpoint) return configuredModel;

    let served;
    try {
        served = await listServedModelIds(normalizedEndpoint, headers, signal);
    } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        return configuredModel; // no list, no guess
    }

    const match = resolveServedModelId(configuredModel, served);
    if (match && match !== configuredModel) {
        warnServedModelOnce(`${normalizedEndpoint}|${configuredModel}|${match}`, `[ai] ${providerLabel} does not serve "${configuredModel}"; using "${match}", the same model by name.`);
        return match;
    }
    if (!match && served?.length) {
        warnServedModelOnce(`${normalizedEndpoint}|${configuredModel}|`, `[ai] ${providerLabel} does not serve "${configuredModel}". It offers: ${served.join(", ")}.`);
    }
    return configuredModel;
}

async function callGemini(systemPrompt, history, {
    canFallBack = false,
    deadline,
    entrySettings,
    maxTokens = 8192,
    onActivity,
    onChunk,
    onRequest,
    onToolStream,
    onUsage,
    rateLimitPolicy = "next",
    retries = 3,
    retryDelay = 15000,
    onModel,
    signal,
    tool,
    taskKey = "",
    lookupTools,
    requireOutputTool = false,
} = {}) {
    const settings = entrySettings;
    // Lookup functions (lookupTools.js) declared beside the output function.
    // They stay declared for the whole conversation (the history carries calls
    // to them); which ones the model may CALL this round is allowedFunctionNames.
    const lookupDeclarations = tool && Array.isArray(lookupTools) ? lookupTools : [];
    const apiKey = settings.apiKey.trim();

    if (!apiKey) {
        throw missingSetupError("Go to **settings** and paste your Gemini API key - you can get it at https://aistudio.google.com/app/apikey", "no API key");
    }

    const model = await resolveModel("gemini", {
        entrySettings,
        fallbackModel: GEMINI_DEFAULT_MODEL,
        providerLabel: "Gemini",
        signal,
    });
    onModel?.(model);

    const customParams = parseCustomParams(settings.customParams, "Gemini");
    const samplingConfig = temperatureBody(taskKey);

    // Sorted once for every retryable status either path below can see, so the
    // Fallback list and the retry count agree (shouldRetryProviderFailure).
    // Chat waits less for a busy model than a turn does: a player is watching.
    const retryOrFail = async (response, attempt, busyDelay = retryDelay) => {
        const payload = await readErrorPayload(response);
        const failure = classifyProviderFailure({ status: response.status, payload });
        const details = extractErrorMessage(payload, `Gemini returned ${response.status}.`);
        if (failure.kind === "spent") {
            throw providerFailureError(`Gemini returned 429: the allowance or balance on this key is used up. ${details}`.trim(), failure);
        }
        // Honour the provider's own RetryInfo when it sent one; it knows the
        // window better than a fixed guess does.
        const wait = failure.kind === "rateLimited" ? (failure.waitMs ?? retryDelay) : busyDelay;
        if (!shouldRetryProviderFailure({ failure, attempt, retries, canFallBack, rateLimitPolicy }) || !canRetryBeforeDeadline(deadline, wait)) {
            if (failure.kind === "rateLimited") {
                throw providerFailureError(
                    `Gemini is rate limiting this key after ${attempt} attempt${attempt === 1 ? "" : "s"}. ${details} `
                    + "Wait a minute and try again, or lower the request rate in Settings.".trim(),
                    failure,
                );
            }
            if (failure.kind === "busy") {
                throw providerFailureError(`Gemini is temporarily unavailable after ${attempt} attempt${attempt === 1 ? "" : "s"}. Try again in a minute.`, failure);
            }
            throw refusedRequestError("Gemini", extractErrorMessage(payload, `Gemini API request failed (${response.status})`), failure);
        }
        console.warn(`[ai] Gemini ${failure.kind === "rateLimited" ? "rate limited" : "is busy"}. Retrying in ${wait / 1000}s... (attempt ${attempt}/${retries})`);
        await sleep(wait, signal);
    };

    // Advisor/chat streaming: with an onChunk callback (and no tool), use the
    // streaming endpoint so the reply appears token-by-token. maxOutputTokens
    // caps this reply at the requested budget — the buffered jump path below
    // deliberately sends NO cap so long simulations are never truncated.
    if (onChunk && !tool) {
        const streamUrl = getGeminiStreamUrl(model, apiKey);
        // A busy or Rate limited status is retried as the Fallback list's rule
        // says (one retry when there is somewhere to fall back to). An
        // overloaded error INSIDE the stream arrives as an HTTP 200, never
        // reaches that check, and gets its own single retry.
        let retriedInStream = false;
        for (let pass = 1; ; pass += 1) {
            const response = await fetch(streamUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: geminiContentsFromHistory(history),
                    generationConfig: {
                        maxOutputTokens: Math.max(1, Number(maxTokens) || 8192),
                        ...samplingConfig,
                        ...(getReasoningEnabled() ? { thinkingConfig: { thinkingBudget: 8192 } } : {}),
                    },
                    ...customParams,
                }),
                signal,
            });
            onRequest?.(response.status);
            if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
                await retryOrFail(response, pass, OVERLOADED_RETRY_DELAY);
                continue;
            }
            if (!response.ok) {
                const payload = await readErrorPayload(response);
                throw refusedRequestError("Gemini",
                    extractErrorMessage(payload, `Gemini API request failed (${response.status})`),
                    classifyProviderFailure({ status: response.status, payload }),
                );
            }
            const streamResult = await streamTextSSE(response, geminiStreamDelta, onChunk);
            if (streamResult.text) return streamResult.text;
            if (!retriedInStream && isBusyErrorPayload(streamResult.streamError) && canRetryBeforeDeadline(deadline, OVERLOADED_RETRY_DELAY)) {
                retriedInStream = true;
                console.warn(`[ai] Gemini reported "${errorPayloadText(streamResult.streamError)}" mid-stream; retrying once in ${OVERLOADED_RETRY_DELAY / 1000}s`);
                await sleep(OVERLOADED_RETRY_DELAY, signal);
                continue;
            }
            throw streamFailureError("Gemini", streamResult, {
                retried: retriedInStream,
                fallbackMessage: "Gemini response did not contain text.",
            });
        }
    }

    let retriedAfterOverload = false;

    for (let attempt = 1; attempt <= retries; attempt++) {
        // Tool calls stream, for the same reason they do on the other three
        // providers: a timeline jump is the longest request the game makes, and
        // a buffered one sends nothing over the wire for the whole generation,
        // which is what an API edge or a proxy cuts. Gemini was the last
        // provider still sending its tool calls buffered — and it is the
        // DEFAULT provider, so a jump on a stock install was the one request
        // most exposed to that. readGeminiStreamedResponse rebuilds the exact
        // envelope the extractors below already read, so nothing downstream
        // changes. (The advisor's own streaming is handled above, where the
        // tokens go to the UI as they arrive.)
        const requestUrl = tool ? getGeminiStreamUrl(model, apiKey) : getGeminiUrl(model, apiKey);
        const generationConfig = {
            ...samplingConfig,
            ...(getReasoningEnabled() ? { thinkingConfig: { thinkingBudget: 8192 } } : {}),
        };
        const response = await fetch(requestUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: geminiContentsFromHistory(history),
                ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
                ...customParams,
                ...(tool ? {
                    tools: [{ functionDeclarations: [
                        {
                            name: tool.name,
                            description: tool.description,
                            parameters: toGeminiSchema(tool.schema),
                        },
                        ...lookupDeclarations.map((entry) => ({
                            name: entry.name,
                            description: entry.description,
                            parameters: toGeminiSchema(entry.schema),
                        })),
                    ] }],
                    toolConfig: { functionCallingConfig: {
                        mode: "ANY",
                        // The final round of a lookup conversation may only answer.
                        allowedFunctionNames: [tool.name, ...(requireOutputTool ? [] : lookupDeclarations.map((entry) => entry.name))],
                    } },
                } : {}),
            }),
            signal,
        });
        // Every response is one request against the player's allowance, whatever
        // became of it (requestBudget.js): a lookup round, a retry, a refusal.
        onRequest?.(response.status);

        // A 429 used to be fatal here while every other provider retried it, so
        // one per-minute trip on a free-tier key destroyed the turn and dropped
        // the player to canned events. Only a SPENT quota (daily allowance, or
        // billing) is worth failing over; a rate limit is what waiting is for —
        // unless the player chose to move straight to the next Fallback entry.
        if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
            await retryOrFail(response, attempt);
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw refusedRequestError("Gemini",
                extractErrorMessage(payload, `Gemini API request failed (${response.status})`),
                classifyProviderFailure({ status: response.status, payload }),
            );
        }

        // Branch on what actually came back, not on what was asked for: an edge
        // or proxy that ignored alt=sse still answers plain JSON, and that must
        // keep working exactly as it did.
        const data = String(response.headers.get("content-type") || "").includes("text/event-stream")
            ? await readGeminiStreamedResponse(response, onActivity, onToolStream)
            : await readJsonAnswer(response, "Gemini");
        onUsage?.(data);
        if (tool) {
            const toolInput = extractGeminiToolInput(data, tool);
            if (toolInput) return { rawText: joinGeminiParts(data?.candidates?.[0]?.content?.parts), toolInput };
            // Not the answer but a question: the model called lookup functions.
            // Handed back to callAI, which answers them and asks again.
            if (lookupDeclarations.length) {
                const lookupCalls = lookupCallsFromGemini(data, tool.name);
                if (lookupCalls.length) return { rawText: joinGeminiParts(data?.candidates?.[0]?.content?.parts), toolInput: null, lookupCalls };
            }

            // Now that tool calls stream, an overloaded model can refuse INSIDE
            // the stream — HTTP 200, an error frame, no function call — where the
            // same refusal used to arrive as a 503 and be retried by status code
            // above. Without this, a hiccup would cost the player a whole turn to
            // the canned fallback, which is what the buffered path protected them
            // from. (Mirrors the OpenAI-compatible path.)
            const streamedError = data?.error;
            const streamedText = joinGeminiParts(data?.candidates?.[0]?.content?.parts);
            if (!streamedText && isBusyErrorPayload(streamedError) && !retriedAfterOverload
                && canRetryBeforeDeadline(deadline, OVERLOADED_RETRY_DELAY)) {
                retriedAfterOverload = true;
                console.warn(`[ai] Gemini reported "${errorPayloadText(streamedError)}" mid-stream; retrying once in ${OVERLOADED_RETRY_DELAY / 1000}s`);
                await sleep(OVERLOADED_RETRY_DELAY, signal);
                continue;
            }
            // Fragments that stopped partway assemble into a valid object missing
            // half the turn, so streamAssembly.js drops the call and leaves this
            // for the log alone.
            if (data?.partialToolJson) {
                logDebugEvent("warn", `[ai] Gemini tool call was cut off mid-argument.`, {
                    partialChars: data.partialToolJson.length,
                }, { verbose: true });
            }
            // Still refusing: say so, rather than hand back an empty "answer".
            if (!streamedText && streamedError) throw toolStreamRefusalError("Gemini", streamedError, retriedAfterOverload);

            return { rawText: streamedText, toolInput: null };
        }
        const text = joinGeminiParts(data?.candidates?.[0]?.content?.parts);

        if (!text) {
            throw new Error("Gemini response did not contain text.");
        }

        return text;
    }
}

// Extra output tokens allowed when reasoning is on, because on an OpenAI-style
// endpoint the chain of thought is spent from the same budget as the answer.
// Sized to a full second answer's worth: a model that thinks for 8k still has 8k
// left to write with.
const REASONING_HEADROOM_TOKENS = 8192;

async function callOpenAIStyleChatCompletions({
    endpoint,
    headers,
    model,
    systemPrompt,
    history,
    providerLabel,
    customParams = {},
    toolStrict = false,
    retries = 3,
    retryDelay = 15000,
    canFallBack = false,
    rateLimitPolicy = "next",
    deadline,
    signal,
    tool,
    onActivity,
    onChunk,
    onRequest,
    onToolStream,
    onUsage,
    allowJsonSchemaFallback = false,
    configuredStructuredMode = "auto",
    observerKey = "",
    maxTokens,
    tokenLimitField = "max_tokens",
    lookupTools,
    taskKey = "",
    requireOutputTool = false,
}) {
    // Lookup functions (lookupTools.js) beside the output function. On the
    // round that must end in an answer they are left out altogether: with one
    // tool declared, tool_choice "required" IS the forcing, on every gateway
    // that honours it at all. (The history still carries the earlier calls;
    // the chat-completions API does not require those tools to be declared.)
    const lookupDeclarations = tool && Array.isArray(lookupTools) && !requireOutputTool ? lookupTools : [];
    // Where to BEGIN on the ladder. "auto" (the default) starts at the strongest
    // method; a configured mode starts lower, skipping rungs this endpoint has
    // already been shown not to honour. Either way the ladder can still walk
    // down from here — a setting is a starting point, never a lock.
    const startedStructuredMode = startingStructuredMode(configuredStructuredMode);
    let structuredMode = tool ? startedStructuredMode : "text";
    // How much this request carries, for the context-window message below:
    // the number the player needs to compare against the model's limit.
    const requestChars = String(systemPrompt ?? "").length + (Array.isArray(history) ? history : []).reduce((total, message) => {
        const parts = Array.isArray(message?.parts) ? message.parts : [];
        return total + (parts.length ? parts.reduce((sum, part) => sum + String(part?.text ?? "").length, 0) : String(message?.content ?? "").length);
    }, 0);
    let disableToolReasoning = false;
    // Set once the model has proved it needs more room than the caller asked for
    // (see the all-reasoning retry below). Lifting the cap entirely hands the
    // model its own maximum, which is what the no-cap branch below already does.
    // It can only flip once, so the retry it drives can only ever add one pass.
    let liftedCapForReasoning = false;
    // Same one-shot discipline as liftedCapForReasoning: it drives a retry that
    // does not consume an attempt, so it must only ever be able to flip once.
    let retriedAfterOverload = false;
    // Set when a gateway refuses stream+tools together (a 400/422 naming the
    // stream parameter). One-shot, and tried BEFORE the structuredMode ladder
    // below: giving up streaming costs a keep-alive, while giving up tool mode
    // costs structured output, so the cheaper concession goes first.
    let streamingDisabled = false;
    // The model answered with its own planning monologue instead of calling the
    // tool (see looksLikeDeliberation in providerErrors.js). One-shot, same
    // discipline as the two above: it drives a retry that does not consume one of
    // runJsonTask's two output attempts, so it must only ever flip once.
    let insistedOnToolCall = false;
    const samplingKey = temperatureRefusalKey({ provider: providerLabel, endpoint, model });
    const ownTemperature = temperatureBody(taskKey);
    let disableTemperature = temperatureRefusals.refuses(samplingKey);
    const wantsReasoning = getReasoningEnabled();

    let attempt = 1;
    while (attempt <= retries) {
        const requestCustomParams = { ...customParams };
        if (disableToolReasoning) {
            delete requestCustomParams.reasoning;
        }
        // In the non-tool modes the answer arrives as ordinary content, so a model
        // that narrates its plan first has nowhere to put it but in the payload.
        // ANSWER_SENTINEL gives it a defined moment to stop thinking and start
        // answering, and gives extractJsonPayload an unambiguous cut point.
        const baseSystemPrompt = structuredMode === "text_json" || structuredMode === "json_object"
            ? `${systemPrompt}\n\nReturn only one JSON object matching this JSON Schema. Do not use markdown or prose outside the object.\n${JSON.stringify(tool.schema)}\n\n${ANSWER_SENTINEL_DIRECTIVE}`
            : systemPrompt;
        const requestSystemPrompt = insistedOnToolCall
            ? `${baseSystemPrompt}${TOOL_CALL_INSISTENCE}`
            : baseSystemPrompt;
        const streamLocalEndpoint = isLocalEndpoint(normalizeEndpoint(endpoint));
        // Every call streams unless a gateway has refused to. Three things need it:
        // Cancel is only PHYSICAL on a local server while tokens are being written
        // (see streamAssembly.js); the advisor/chat path (onChunk) shows tokens as
        // EVERY request streams unless the gateway has refused to. The reason is
        // keep-alive, not rendering: a buffered request sends zero bytes for the
        // whole generation, which is indistinguishable from a dead one, and a
        // gateway closes it (the 502 at 301.7s behind streamAssembly.js).
        //
        // Diplomatic chat was the last buffered path in the game, being the only
        // call with neither a tool nor an onChunk. It failed on exactly this: an
        // NVIDIA endpoint 502ing every leader reply after ~38s of silence, while
        // the ADVISOR - a BIGGER prompt on the same endpoint - worked fine, because
        // it renders tokens and therefore streamed. Nothing downstream changes: the
        // readers reassemble the provider's normal envelope.
        const streamThisRequest = !streamingDisabled;
        const response = await providerFetch(`${normalizeEndpoint(endpoint)}/chat/completions`, {
            headers,
            signal,
            payload: {
                model,
                ...(streamThisRequest ? { stream: true } : {}),
                messages: toOpenAIMessages(requestSystemPrompt, history),
                // Reasoning toggle (settings) — honored by o-series/gpt-5 models and
                // most OpenAI-compatible gateways. Sent in EVERY mode, tool calls
                // included: local backends (textgen/oobabooga, llama.cpp) map it onto
                // the model's thinking mode, and omitting it in tool mode silently
                // turned reasoning off for every turn once tool calls started
                // succeeding (#367 — before the tool_choice fix those requests
                // fell back to non-tool modes, which DID carry it). Providers that
                // reject the tools+reasoning combination surface the documented
                // error below and the call retries without it.
                ...(getReasoningEnabled() && !disableToolReasoning ? { reasoning_effort: "medium" } : {}),
                // Thinking-class local models (Qwen3, Seed-OSS) key on
                // enable_thinking, not reasoning_effort — textgen/oobabooga
                // honors it per-request, llama.cpp/LM Studio ignore unknown
                // fields. Local endpoints only: strict cloud APIs reject
                // unknown parameters. Sent only when the toggle is ON so a
                // server-side --enable-thinking default is never overridden.
                ...(streamLocalEndpoint && getReasoningEnabled() && !disableToolReasoning ? { enable_thinking: true } : {}),
                // No cap unless a caller asked for a specific budget: omit the field so
                // the provider uses the model's own maximum (long turns aren't truncated).
                //
                // Reasoning eats the SAME budget as the answer here — unlike Anthropic,
                // there is no separate thinking allowance to raise — so a thinking model
                // asked for 8192 can spend all 8192 thinking and emit no answer at all.
                // Add headroom for the thinking, and drop the cap entirely once a reply
                // has already come back as reasoning-only.
                ...(Number(maxTokens) > 0 && !liftedCapForReasoning
                    ? { [tokenLimitField]: Number(maxTokens) + (wantsReasoning && !tool ? REASONING_HEADROOM_TOKENS : 0) }
                    : {}),
                ...(disableTemperature ? {} : ownTemperature),
                ...requestCustomParams,
                ...(structuredMode === "tool" && disableToolReasoning ? { reasoning_effort: "none" } : {}),
                ...(structuredMode === "tool" ? {
                    tools: [{ type: "function", function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.schema,
                    // Opt-in only. OpenAI rejects strict:true unless every property
                    // is named in required, which these schemas deliberately do not
                    // do; self-hosted grammar backends (SGLang/xgrammar, vLLM) take
                    // the schema as-is and constrain generation with it, which is
                    // what stops a model emitting an unbalanced or mistyped argument.
                    ...(toolStrict ? { strict: true } : {}),
                    } }, ...lookupDeclarations.map((entry) => ({
                        type: "function",
                        function: { name: entry.name, description: entry.description, parameters: entry.schema },
                    }))],
                    // The string form, NOT OpenAI's {type:"function",function:{name}}
                    // object: llama.cpp-based servers (LM Studio, Jan, local Qwen et
                    // al.) only parse a string here — the object form logged
                    // "Wrong type supplied for parameter 'tool_choice'" every jump
                    // and silently fell back to "auto", losing the forcing. Exactly
                    // one tool is ever sent, so "required" (accepted by OpenAI and
                    // the compatible gateways alike) forces that same tool.
                    tool_choice: "required",
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
        onRequest?.(response.status);

        // One read of the body serves every concession below — a Response can only
        // be read once, and the streaming retry has to look at the message before
        // the structured-output ladder gets its turn.
        if ([400, 422].includes(response.status)) {
            const payload = await readErrorPayload(response);
            const errorMessage = extractErrorMessage(payload, `${providerLabel} request failed (${response.status})`);
            // A bad key, a missing model or a spent balance can arrive as a 400
            // too; none of the concessions below would fix those.
            const failure = classifyProviderFailure({ status: response.status, payload });
            if (waitingCannotFix(failure)) throw providerFailureError(errorMessage, failure);
            // Too big for the window: no concession below shrinks the request, and
            // walking the ladder would spend a request per rung finding that out.
            if (failure.kind === "tooBig") throw providerFailureError(contextWindowMessage(providerLabel, errorMessage, requestChars), failure);

            const sentOwnTemperature = Object.keys(ownTemperature).length > 0
                && requestCustomParams.temperature === undefined;
            if (!disableTemperature && sentOwnTemperature && isTemperatureRefusal(errorMessage)) {
                disableTemperature = true;
                temperatureRefusals.learn(samplingKey);
                console.warn(`[ai] ${providerLabel} refused the requested temperature; retrying at the model's own, and remembering.`);
                continue;
            }

            // Next cheapest. A gateway that refuses stream+tools still
            // does tools, it just stops keeping the connection warm — whereas
            // dropping out of tool mode costs structured output, which is the
            // difference between a real turn and canned events.
            if (streamThisRequest && isStreamingRefusal(errorMessage)) {
                streamingDisabled = true;
                console.warn(`[ai] ${providerLabel} refused a streamed request; retrying buffered — long turns on this endpoint may time out.`);
                continue;
            }

            if (structuredMode === "tool") {
                const reasoningConflict = /function tools.*reasoning_effort.*not supported|reasoning_effort.*not supported.*function tools/i.test(errorMessage);

                if (!disableToolReasoning && reasoningConflict) {
                    disableToolReasoning = true;
                    continue;
                }

                if (allowJsonSchemaFallback) {
                    structuredMode = "json_schema";
                    continue;
                }

                throw providerFailureError(errorMessage, failure);
            }

            if (structuredMode === "json_schema" && allowJsonSchemaFallback) {
                structuredMode = "json_object";
                continue;
            }

            if (structuredMode === "json_object" && allowJsonSchemaFallback) {
                structuredMode = "text_json";
                continue;
            }

            // Nothing left to concede. Throw the message we already read rather
            // than falling through to the generic handler below, which would try
            // to read this same body a second time and get nothing.
            throw providerFailureError(errorMessage, failure);
        }

        if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
            await retryOrFailByStatus(response, {
                attempt, retries, retryDelay, deadline, signal, canFallBack, rateLimitPolicy, providerLabel,
            });
            attempt += 1;
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            const detail = extractErrorMessage(payload, `${providerLabel} request failed (${response.status})`);
            // Too big for the model: say so, with the size, and do not let it be
            // mistaken for a busy provider or a broken answer. "tooBig" lets the
            // Fallback list try an entry with a larger window, and remembers
            // this one's (contextWindow.js).
            if (isContextWindowErrorPayload(payload?.error ?? payload)) {
                throw providerFailureError(contextWindowMessage(providerLabel, detail, requestChars), { kind: "tooBig", reason: detail });
            }
            throw providerFailureError(detail, classifyProviderFailure({ status: response.status, payload }));
        }

        // Advisor/chat streaming: forward tokens to the UI as they arrive. Guard
        // on the actual content-type so a gateway that ignored stream:true (plain
        // JSON) safely falls through to the buffered path below.
        if (onChunk && !tool && String(response.headers.get("content-type") || "").includes("text/event-stream")) {
            const streamResult = await streamTextSSE(response, openaiStreamDelta, onChunk);
            const { text: streamed, reasoning: streamedReasoning, streamError } = streamResult;
            if (streamed) return streamed;
            // The provider said what went wrong inside the stream. Say THAT
            // rather than the generic empty-reply guess below — and if it was
            // simply busy, wait and ask again before troubling the player.
            if (streamError) {
                const detail = errorPayloadText(streamError);
                const busy = isBusyErrorPayload(streamError);
                if (busy && !retriedAfterOverload && canRetryBeforeDeadline(deadline, OVERLOADED_RETRY_DELAY)) {
                    retriedAfterOverload = true;
                    console.warn(`[ai] ${providerLabel} reported "${detail}" mid-stream; retrying once in ${OVERLOADED_RETRY_DELAY / 1000}s`);
                    await sleep(OVERLOADED_RETRY_DELAY, signal);
                    continue;
                }
                throw streamFailureError(providerLabel, streamResult, { retried: retriedAfterOverload });
            }
            // The model thought and never answered: it spent the whole budget
            // reasoning. Give it room and ask once more, rather than erroring or
            // (worse) passing its chain of thought off as advice. Anthropic has
            // always raised max_tokens to fit its thinking budget; this is the
            // same idea for a provider that gives no budget knob to raise.
            if (streamedReasoning && !liftedCapForReasoning) {
                liftedCapForReasoning = true;
                console.warn(`[ai] ${providerLabel} returned only reasoning; retrying with the token cap lifted`);
                continue;
            }
            throw aiFailureError(emptyReplyMessage(providerLabel), {
                provider: providerLabel,
                model,
                mode: "streaming chat",
                reasoningEnabled: wantsReasoning,
                tokenCapLifted: liftedCapForReasoning,
                requestedMaxTokens: Number(maxTokens) || 0,
                finishReason: streamResult.finishReason || "(none reported)",
                streamFrames: streamResult.frames,
                answerChars: streamed.length,
                reasoningChars: streamedReasoning.length,
                reasoningTail: streamedReasoning.slice(-600),
                sampleFrames: streamResult.sample,
            });
        }

        // Servers that honor stream:true answer as an event stream; ones that
        // ignore it still answer plain JSON — branch on what actually came back,
        // not on what was asked for. That guard is why asking every tool call to
        // stream is safe: a gateway that quietly ignores it still lands here.
        const responseType = String(response.headers.get("content-type") || "");
        const data = responseType.includes("text/event-stream")
            ? await readOpenAIStreamedResponse(response, onActivity, onToolStream)
            : await readJsonAnswer(response, providerLabel);
        onUsage?.(data);
        const text = extractOpenAIMessageText(data);

        // Some gateways put "the request does not fit the context window" in a
        // 200 body as if it were the answer. It is not one, and no retry can help
        // (the retry carries the failed answer too), so say what happened rather
        // than letting it fail downstream as "did not contain parseable JSON".
        if (isContextWindowErrorText(text) || isContextWindowErrorPayload(data?.error)) {
            const detail = text || errorPayloadText(data?.error);
            throw providerFailureError(contextWindowMessage(providerLabel, detail, requestChars), { kind: "tooBig", reason: detail });
        }

        if (tool) {
            const toolInput = structuredMode === "tool" ? extractOpenAIToolInput(data, tool) : null;
            if (toolInput) return { rawText: text, toolInput };
            // Not the answer but a question: the model called lookup functions.
            if (structuredMode === "tool" && lookupDeclarations.length) {
                const lookupCalls = lookupCallsFromOpenAI(data, tool.name);
                if (lookupCalls.length) return { rawText: text, toolInput: null, lookupCalls };
            }

            // Now that tool calls stream, an overloaded provider can refuse INSIDE
            // the stream — HTTP 200, an error frame, no tool call — where the same
            // refusal used to arrive as a 429/503 and be retried by status code
            // above. Without this, a provider hiccup would cost the player a whole
            // turn to the canned fallback, which is exactly what the buffered path
            // protected them from.
            const streamedError = data?.error;
            if (!text && isBusyErrorPayload(streamedError) && !retriedAfterOverload
                && canRetryBeforeDeadline(deadline, OVERLOADED_RETRY_DELAY)) {
                retriedAfterOverload = true;
                console.warn(`[ai] ${providerLabel} reported "${errorPayloadText(streamedError)}" mid-stream; retrying once in ${OVERLOADED_RETRY_DELAY / 1000}s`);
                await sleep(OVERLOADED_RETRY_DELAY, signal);
                continue;
            }
            // Still refusing after that retry (or no time left for one): say so,
            // rather than hand the task an empty "answer" to spend an attempt on.
            // A partial tool call is left to the salvage pass, as before.
            if (!text && streamedError && !extractOpenAIToolRaw(data, tool)) {
                throw toolStreamRefusalError(providerLabel, streamedError, retriedAfterOverload);
            }

            // The model talked itself out of answering: no tool call, and the text
            // is a planning monologue rather than anything a salvage pass could
            // parse. Left alone this returns unparseable prose, runJsonTask spends
            // an attempt on it, the same thing happens again, and the player loses
            // the turn to canned events — 3 of 4 turns in the field report behind
            // looksLikeDeliberation.
            //
            // The first version of this just re-asked for the tool call, more
            // firmly. That does not work, and the log says why: the model spent
            // 192s producing a CORRECT plan ("...Let's craft 11 events") and simply
            // never switched to answering. Its gateway accepts tool_choice:
            // "required" without enforcing it, so the tool channel is advisory —
            // and you cannot nag a model into a channel nobody is policing.
            //
            // So change the channel instead of the volume. The structuredMode
            // ladder already exists for exactly this and already knows how to
            // inline the schema and ask for plain JSON; it simply never fired
            // here, because it only advances on an HTTP 400/422 and this arrives
            // as a perfectly good 200 full of prose. Advance it on "no tool call"
            // too. Each rung transitions at most once, so this terminates.
            if (looksLikeDeliberation(text) && canRetryBeforeDeadline(deadline, 0)) {
                // The rung order lives in structuredMode.js, with the tests that
                // pin it. Native OpenAI enforces tool_choice, so it never steps
                // down out of tool mode - a deliberating model there is a
                // different problem, handled by the insistence retry below.
                const canStepDown = structuredMode !== "tool" || allowJsonSchemaFallback;
                const nextMode = canStepDown ? nextStructuredMode(structuredMode) : null;
                if (nextMode) {
                    console.warn(`[ai] ${providerLabel} deliberated instead of calling ${tool.name}; dropping from ${structuredMode} to ${nextMode}`);
                    structuredMode = nextMode;
                    liftedCapForReasoning = true;
                    insistedOnToolCall = true;
                    continue;
                }
                if (!insistedOnToolCall) {
                    insistedOnToolCall = true;
                    liftedCapForReasoning = true;
                    console.warn(`[ai] ${providerLabel} deliberated instead of calling ${tool.name}; retrying once, insisting on the tool call`);
                    continue;
                }
            }

            if (structuredMode === "tool") return { rawText: extractOpenAIToolRaw(data, tool) || text, toolInput: null };
            // Landed below where this call began, with something to show for it.
            // The ladder only steps down after a failure above, so arriving here
            // with content is the endpoint telling us which method it honours —
            // recorded so the player can be offered it after a second sighting
            // rather than the game re-learning it on every call.
            if (text) noteStructuredModeLanding(observerKey, startedStructuredMode, structuredMode, configuredStructuredMode);
            if (structuredMode === "json_schema" && text) return { rawText: text, toolInput: null };
            return { rawText: text, toolInput: null };
        }

        if (!text) {
            // A gateway that ignored stream:true puts the same overload error in
            // a 200 body instead of a frame — same cause, same handling.
            const bufferedError = data?.error;
            const bufferedDetail = errorPayloadText(bufferedError);
            const bufferedBusy = isBusyErrorPayload(bufferedError);
            if (bufferedBusy && !retriedAfterOverload && canRetryBeforeDeadline(deadline, OVERLOADED_RETRY_DELAY)) {
                retriedAfterOverload = true;
                console.warn(`[ai] ${providerLabel} reported "${bufferedDetail}"; retrying once in ${OVERLOADED_RETRY_DELAY / 1000}s`);
                await sleep(OVERLOADED_RETRY_DELAY, signal);
                continue;
            }
            const bufferedMessage = bufferedError
                ? (bufferedBusy ? busyProviderMessage(providerLabel, bufferedDetail, retriedAfterOverload)
                    : providerErrorReplyMessage(providerLabel, bufferedDetail))
                : emptyReplyMessage(providerLabel);
            throw aiFailureError(bufferedMessage, {
                provider: providerLabel,
                model,
                mode: "buffered chat",
                ...(bufferedError ? { providerError: bufferedDetail || "(no message)", retriedAfterOverload } : {}),
                reasoningEnabled: wantsReasoning,
                requestedMaxTokens: Number(maxTokens) || 0,
                finishReason: data?.choices?.[0]?.finish_reason || "(none reported)",
                // The whole envelope, minus anything that could carry a key.
                responseShape: Object.keys(data ?? {}),
                messageKeys: Object.keys(data?.choices?.[0]?.message ?? {}),
                rawResponse: JSON.stringify(data ?? {}).slice(0, 1500),
            });
        }

        return text;
    }
}

async function callOpenAI(systemPrompt, history, opts = {}) {
    const { entrySettings, ...rest } = opts;
    const settings = entrySettings;
    const apiKey = settings.apiKey.trim();

    if (!apiKey) {
        throw missingSetupError("Go to **settings** and paste your OpenAI API key.", "no API key");
    }

    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
    };

    const model = await resolveModel("openai", {
        entrySettings,
        endpoint: OPENAI_API_ENDPOINT,
        headers,
        fallbackModel: OPENAI_DEFAULT_MODEL,
        providerLabel: "OpenAI",
        signal: opts.signal,
    });
    opts.onModel?.(model);

    return callOpenAIStyleChatCompletions({
        endpoint: OPENAI_API_ENDPOINT,
        headers,
        model,
        systemPrompt,
        history,
        providerLabel: "OpenAI",
        customParams: parseCustomParams(settings.customParams, "OpenAI"),
        allowJsonSchemaFallback: false,
        configuredStructuredMode: settings.structuredMode,
        observerKey: settings.id,
        tokenLimitField: "max_completion_tokens",
        ...rest,
    });
}

async function callOpenAICompatible(systemPrompt, history, opts = {}) {
    const { entrySettings, ...rest } = opts;
    const settings = entrySettings;
    const endpoint = normalizeEndpoint(settings.endpoint);

    if (!endpoint) {
        throw missingSetupError("Go to **settings** and enter the OpenAI Compatible endpoint (for example http://localhost:11434/v1).", "no endpoint set");
    }

    const headers = {
        "Content-Type": "application/json",
        ...(settings.apiKey.trim() ? { Authorization: `Bearer ${settings.apiKey.trim()}` } : {}),
    };

    const model = await resolveModel("openai-compatible", {
        entrySettings,
        endpoint,
        headers,
        providerLabel: "OpenAI Compatible",
        signal: opts.signal,
    });
    opts.onModel?.(model);

    return callOpenAIStyleChatCompletions({
        endpoint,
        headers,
        model,
        systemPrompt,
        history,
        providerLabel: "OpenAI Compatible",
        customParams: parseCustomParams(settings.customParams, "OpenAI Compatible"),
        toolStrict: settings.toolStrict === true,
        allowJsonSchemaFallback: true,
        configuredStructuredMode: settings.structuredMode,
        observerKey: settings.id,
        tokenLimitField: "max_tokens",
        ...rest,
    });
}

// Anthropic REQUIRES max_tokens and 400s if it exceeds the model's ceiling (the error
// states that ceiling). Since the output cap was removed on purpose, request the model's
// maximum: start high, and on that 400 learn + cache the model's real ceiling so later
// calls use it directly (no repeated 400s). A high start lets capable models use their
// full range while low-ceiling models self-correct on the first call.
const ANTHROPIC_MAX_OUTPUT = 64000;
const anthropicModelMax = new Map(); // model -> learned output ceiling

// Prompt-cache boundary (promptLayout.js): the system prompt goes out as two
// content blocks — the game-lifetime prefix pinned with an ephemeral
// cache_control breakpoint, and the per-turn tail uncached. Within an
// auto-jump chain or a retry the prefix is byte-identical, so every
// consecutive call reads it from the cache at a fraction of the input price.
// One breakpoint is enough (the API allows four); a prompt with no usable
// boundary goes out as the plain string it always was.
function buildAnthropicSystemContent(systemPrompt, staticPrefixEnd) {
    const split = splitSystemPromptForCache(systemPrompt, staticPrefixEnd);
    if (!split) return systemPrompt;
    return [
        { type: "text", text: split.prefix, cache_control: { type: "ephemeral" } },
        { type: "text", text: split.tail },
    ];
}

async function callAnthropic(systemPrompt, history, {
    canFallBack = false,
    deadline,
    entrySettings,
    maxTokens,
    onActivity,
    onChunk,
    onRequest,
    onToolStream,
    onUsage,
    rateLimitPolicy = "next",
    retries = 3,
    retryDelay = 15000,
    onModel,
    signal,
    staticPrefixEnd,
    tool,
    taskKey = "",
    lookupTools,
    requireOutputTool = false,
} = {}) {
    let retriedAfterOverload = false;
    // Lookup functions (lookupTools.js) declared beside the output function.
    const lookupDeclarations = tool && Array.isArray(lookupTools) ? lookupTools : [];
    // Anthropic tool calls stream (see the request body below); this flips if the
    // endpoint refuses to, so the call retries buffered instead of failing.
    let streamingDisabled = false;
    const settings = entrySettings;
    const apiKey = settings.apiKey.trim();

    if (!apiKey) {
        throw missingSetupError("Go to **settings** and paste your Anthropic API key.", "no API key");
    }

    const model = await resolveModel("anthropic", {
        entrySettings,
        fallbackModel: ANTHROPIC_DEFAULT_MODEL,
        providerLabel: "Anthropic",
        signal,
    });
    onModel?.(model);

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
    // Uncapped by default -> the model's own maximum (learned from a prior 400).
    let requestedMaxTokens = Number(maxTokens) > 0
        ? Number(maxTokens)
        : Math.max(Number(customParams.max_tokens) || 0, anthropicModelMax.get(model) || ANTHROPIC_MAX_OUTPUT);
    delete customParams.max_tokens;

    for (let attempt = 1; attempt <= retries; attempt++) {
        // EVERY request streams unless the gateway has refused to. The reason is
        // keep-alive, not rendering: a buffered request sends zero bytes for the
        // whole generation, which is indistinguishable from a dead one, and a
        // gateway closes it (the 502 at 301.7s behind streamAssembly.js).
        //
        // Diplomatic chat was the last buffered path in the game, being the only
        // call with neither a tool nor an onChunk. It failed on exactly this: an
        // NVIDIA endpoint 502ing every leader reply after ~38s of silence, while
        // the ADVISOR - a BIGGER prompt on the same endpoint - worked fine, because
        // it renders tokens and therefore streamed. Nothing downstream changes: the
        // readers reassemble the provider's normal envelope.
        const streamThisRequest = !streamingDisabled;
        const body = {
            model,
            system: buildAnthropicSystemContent(systemPrompt, staticPrefixEnd),
            max_tokens: requestedMaxTokens,
            ...(reasoning && !tool ? { thinking: { type: "enabled", budget_tokens: 4096 } } : {}),
            ...temperatureBody(taskKey, { enabled: !(reasoning && !tool) }),
            // Streamed for BOTH the advisor (onChunk, tokens to the UI) and tool
            // calls. A tool call must stream because the Messages API refuses a
            // non-streaming request whose max_tokens implies a long generation —
            // and max_tokens above is the model's own maximum, uncapped on
            // purpose — so a timeline jump could be rejected before generating a
            // single token. readAnthropicStreamedResponse rebuilds the envelope.
            ...(streamThisRequest ? { stream: true } : {}),
            messages: toAnthropicMessages(history),
            ...customParams,
            ...(tool ? {
                tools: [
                    { name: tool.name, description: tool.description, input_schema: tool.schema },
                    ...lookupDeclarations.map((entry) => ({ name: entry.name, description: entry.description, input_schema: entry.schema })),
                ],
                // "any" while lookups are allowed (the model picks a lookup or
                // the answer); the answer alone once the round budget is spent.
                tool_choice: lookupDeclarations.length && !requireOutputTool ? { type: "any" } : { type: "tool", name: tool.name },
            } : {}),
        };
        const response = await fetch(`${ANTHROPIC_API_ENDPOINT}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal,
        });
        onRequest?.(response.status);

        if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
            await retryOrFailByStatus(response, {
                attempt, retries, retryDelay, deadline, signal, canFallBack, rateLimitPolicy, providerLabel: "Anthropic",
            });
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            const message = extractErrorMessage(payload, `Anthropic request failed (${response.status})`);
            // A spent balance ("credit balance is too low") and a bad key both
            // arrive as errors none of the concessions below can fix.
            const failure = classifyProviderFailure({ status: response.status, payload });
            if (waitingCannotFix(failure)) throw providerFailureError(message, failure);
            // The cap was removed on purpose; honor the MODEL's own ceiling. Anthropic 400s
            // "max_tokens: <sent> > <max>, ..." — learn <max>, cache it, and retry at it.
            const capMatch = /max_tokens:\s*\d+\s*>\s*(\d+)/i.exec(message);
            if (response.status === 400 && capMatch && Number(capMatch[1]) > 0
                && Number(capMatch[1]) < requestedMaxTokens && attempt < retries) {
                anthropicModelMax.set(model, Number(capMatch[1]));
                requestedMaxTokens = Number(capMatch[1]);
                continue;
            }
            // The OTHER max_tokens complaint, and the one that used to cost a
            // whole turn: the API refuses a non-streaming request this long
            // instead of naming a ceiling, so capMatch above never fires and the
            // error fell straight through to the canned fallback. Only reachable
            // if streaming was turned off below.
            if (response.status === 400 && streamingDisabled && isStreamingRequired(message) && attempt < retries) {
                streamingDisabled = false;
                console.warn("[ai] Anthropic requires streaming for a request this long; re-enabling it.");
                continue;
            }
            // The reverse: an endpoint that will not stream at all. Give up the
            // keep-alive rather than the request.
            if (response.status === 400 && streamThisRequest && isStreamingRefusal(message) && attempt < retries) {
                streamingDisabled = true;
                console.warn("[ai] Anthropic refused a streamed request; retrying buffered — long turns may time out.");
                continue;
            }
            throw refusedRequestError("Anthropic", message, failure);
        }

        if (onChunk && !tool && String(response.headers.get("content-type") || "").includes("text/event-stream")) {
            const streamResult = await streamTextSSE(response, anthropicStreamDelta, onChunk);
            if (streamResult.text) return streamResult.text;
            // overloaded_error arrives as an error EVENT on a 200 stream, so the
            // status-code retry above never sees it. Wait and ask once more.
            if (!retriedAfterOverload && isBusyErrorPayload(streamResult.streamError)
                && canRetryBeforeDeadline(deadline, OVERLOADED_RETRY_DELAY)) {
                retriedAfterOverload = true;
                console.warn(`[ai] Anthropic reported "${errorPayloadText(streamResult.streamError)}" mid-stream; retrying once in ${OVERLOADED_RETRY_DELAY / 1000}s`);
                await sleep(OVERLOADED_RETRY_DELAY, signal);
                continue;
            }
            throw streamFailureError("Anthropic", streamResult, {
                retried: retriedAfterOverload,
                fallbackMessage: "Anthropic response did not contain text.",
            });
        }

        // A streamed tool call comes back as SSE; readAnthropicStreamedResponse
        // rebuilds the Messages envelope the extractors below already read, so
        // nothing downstream can tell the difference. Branch on what actually
        // arrived, so an endpoint that ignored stream:true still works.
        const data = String(response.headers.get("content-type") || "").includes("text/event-stream")
            ? await readAnthropicStreamedResponse(response, onActivity, onToolStream)
            : await readJsonAnswer(response, "Anthropic");
        onUsage?.(data);
        if (tool) {
            const toolInput = extractAnthropicToolInput(data, tool);
            if (toolInput) return { rawText: extractAnthropicText(data), toolInput };
            // Not the answer but a question: the model called lookup functions.
            if (lookupDeclarations.length) {
                const lookupCalls = lookupCallsFromAnthropic(data, tool.name);
                if (lookupCalls.length) return { rawText: extractAnthropicText(data), toolInput: null, lookupCalls };
            }

            // Streaming moved the overload refusal from an HTTP status into an
            // error EVENT on a 200, which the status-code retry above cannot see.
            // Without this a provider hiccup costs the player the whole turn.
            if (isBusyErrorPayload(data?.error) && !retriedAfterOverload
                && canRetryBeforeDeadline(deadline, OVERLOADED_RETRY_DELAY)) {
                retriedAfterOverload = true;
                console.warn(`[ai] Anthropic reported "${errorPayloadText(data.error)}" mid-stream; retrying once in ${OVERLOADED_RETRY_DELAY / 1000}s`);
                await sleep(OVERLOADED_RETRY_DELAY, signal);
                continue;
            }
            // A tool call the stream was cut off partway through: the fragment is
            // logged, never returned as content. Half a turn presented as a whole
            // one is worse than falling back (see jsonSalvage.js).
            if (data?.partialToolJson) {
                logDebugEvent("warn", `[ai] Anthropic tool call was cut off mid-argument.`, {
                    partialChars: data.partialToolJson.length,
                }, { verbose: true });
            }
            // Still refusing: say so, rather than hand back an empty "answer".
            const anthropicToolText = extractAnthropicText(data);
            if (!anthropicToolText && data?.error) throw toolStreamRefusalError("Anthropic", data.error, retriedAfterOverload);
            return { rawText: anthropicToolText, toolInput: null };
        }
        const text = extractAnthropicText(data);

        if (!text) {
            throw new Error("Anthropic response did not contain text.");
        }

        return text;
    }
}

async function callAnthropicCompatible(systemPrompt, history, {
    canFallBack = false,
    deadline,
    entrySettings,
    maxTokens,
    onActivity,
    onChunk,
    onRequest,
    onToolStream,
    onUsage,
    rateLimitPolicy = "next",
    retries = 3,
    retryDelay = 15000,
    onModel,
    signal,
    staticPrefixEnd,
    tool,
    taskKey = "",
    lookupTools,
    requireOutputTool = false,
} = {}) {
    let retriedAfterOverload = false;
    // Lookup functions (lookupTools.js) declared beside the output function.
    const lookupDeclarations = tool && Array.isArray(lookupTools) ? lookupTools : [];
    // Same as the native path: tool calls stream, and this flips if the proxy
    // refuses to so the call retries buffered.
    let streamingDisabled = false;
    const settings = entrySettings;
    const endpoint = normalizeEndpoint(settings.endpoint);

    if (!endpoint) {
        throw missingSetupError("Go to **settings** and enter the Anthropic Compatible endpoint (a self-hosted Anthropic Messages API proxy).", "no endpoint set");
    }

    const apiKey = settings.apiKey.trim();
    const model = await resolveModel("anthropic-compatible", {
        entrySettings,
        fallbackModel: ANTHROPIC_DEFAULT_MODEL,
        providerLabel: "Anthropic Compatible",
        signal,
    });
    onModel?.(model);

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
    // Uncapped by default -> the model's own maximum (learned from a prior 400).
    let requestedMaxTokens = Number(maxTokens) > 0
        ? Number(maxTokens)
        : Math.max(Number(customParams.max_tokens) || 0, anthropicModelMax.get(model) || ANTHROPIC_MAX_OUTPUT);
    delete customParams.max_tokens;

    // This is a SELF-HOSTED PROXY, not Anthropic — the same risk the
    // OpenAI-compatible path carries, and the reason both exist as separate
    // providers from their native siblings. A proxy may accept `tool_choice` and
    // then not enforce it, leaving the model free to narrate its plan and never
    // emit the call. Native Anthropic honours its own contract and needs none of
    // this, which is why it does not have it.
    //
    // The Messages API has no `response_format`, so there is no json_schema or
    // json_object rung here: the ladder is two steps, tool -> text_json, with the
    // schema moved into the system prompt. A shorter fall, but the FIRST step is
    // the one that rescued a real endpoint.
    const anthropicStartMode = startingStructuredMode(settings.structuredMode) === "tool" ? "tool" : "text_json";
    let structuredMode = tool ? anthropicStartMode : "text";
    let insistedOnToolCall = false;
    // Per Fallback entry: the observation is per provider AND model (the same
    // proxy can front one model that honours tool calling and one that does not),
    // and an entry is exactly that pair.
    const observerKey = settings.id;

    for (let attempt = 1; attempt <= retries; attempt++) {
        const useToolChannel = Boolean(tool) && structuredMode === "tool";
        // In text_json the schema has to travel in the prompt, since there is no
        // parameter to carry it. The sentinel gives a rambling model a defined
        // point to stop planning and start answering (jsonSalvage.js).
        const requestSystemPrompt = tool && structuredMode === "text_json"
            ? `${systemPrompt}\n\nReturn only one JSON object matching this JSON Schema. Do not use markdown or prose outside the object.\n${JSON.stringify(tool.schema)}\n\n${ANSWER_SENTINEL_DIRECTIVE}`
            : systemPrompt;
        // EVERY request streams unless the gateway has refused to. The reason is
        // keep-alive, not rendering: a buffered request sends zero bytes for the
        // whole generation, which is indistinguishable from a dead one, and a
        // gateway closes it (the 502 at 301.7s behind streamAssembly.js).
        //
        // Diplomatic chat was the last buffered path in the game, being the only
        // call with neither a tool nor an onChunk. It failed on exactly this: an
        // NVIDIA endpoint 502ing every leader reply after ~38s of silence, while
        // the ADVISOR - a BIGGER prompt on the same endpoint - worked fine, because
        // it renders tokens and therefore streamed. Nothing downstream changes: the
        // readers reassemble the provider's normal envelope.
        const streamThisRequest = !streamingDisabled;
        const body = {
            model,
            system: buildAnthropicSystemContent(requestSystemPrompt, staticPrefixEnd),
            max_tokens: requestedMaxTokens,
            ...(reasoning && !tool ? { thinking: { type: "enabled", budget_tokens: 4096 } } : {}),
            ...temperatureBody(taskKey, { enabled: !(reasoning && !tool) }),
            // Streamed for BOTH the advisor (onChunk, tokens to the UI) and tool
            // calls. A tool call must stream because the Messages API refuses a
            // non-streaming request whose max_tokens implies a long generation —
            // and max_tokens above is the model's own maximum, uncapped on
            // purpose — so a timeline jump could be rejected before generating a
            // single token. readAnthropicStreamedResponse rebuilds the envelope.
            ...(streamThisRequest ? { stream: true } : {}),
            messages: toAnthropicMessages(history),
            ...customParams,
            ...(useToolChannel ? {
                tools: [
                    { name: tool.name, description: tool.description, input_schema: tool.schema },
                    ...lookupDeclarations.map((entry) => ({ name: entry.name, description: entry.description, input_schema: entry.schema })),
                ],
                tool_choice: lookupDeclarations.length && !requireOutputTool ? { type: "any" } : { type: "tool", name: tool.name },
            } : {}),
        };
        const response = await providerFetch(`${endpoint}/messages`, { headers, payload: body, signal });
        onRequest?.(response.status);

        if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
            await retryOrFailByStatus(response, {
                attempt, retries, retryDelay, deadline, signal, canFallBack, rateLimitPolicy, providerLabel: "The Anthropic-compatible endpoint",
            });
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            const message = extractErrorMessage(payload, `Anthropic-compatible request failed (${response.status})`);
            const failure = classifyProviderFailure({ status: response.status, payload });
            if (waitingCannotFix(failure)) throw providerFailureError(message, failure);
            // Honor the model's own max_tokens ceiling (the cap was removed on purpose).
            const capMatch = /max_tokens:\s*\d+\s*>\s*(\d+)/i.exec(message);
            if (response.status === 400 && capMatch && Number(capMatch[1]) > 0
                && Number(capMatch[1]) < requestedMaxTokens && attempt < retries) {
                anthropicModelMax.set(model, Number(capMatch[1]));
                requestedMaxTokens = Number(capMatch[1]);
                continue;
            }
            // The OTHER max_tokens complaint, and the one that used to cost a
            // whole turn: the API refuses a non-streaming request this long
            // instead of naming a ceiling, so capMatch above never fires and the
            // error fell straight through to the canned fallback. Only reachable
            // if streaming was turned off below.
            if (response.status === 400 && streamingDisabled && isStreamingRequired(message) && attempt < retries) {
                streamingDisabled = false;
                console.warn("[ai] Anthropic-compatible requires streaming for a request this long; re-enabling it.");
                continue;
            }
            // The reverse: an endpoint that will not stream at all. Give up the
            // keep-alive rather than the request.
            if (response.status === 400 && streamThisRequest && isStreamingRefusal(message) && attempt < retries) {
                streamingDisabled = true;
                console.warn("[ai] Anthropic-compatible refused a streamed request; retrying buffered — long turns may time out.");
                continue;
            }
            throw refusedRequestError("The Anthropic-compatible endpoint", message, failure);
        }

        if (onChunk && !tool && String(response.headers.get("content-type") || "").includes("text/event-stream")) {
            const streamResult = await streamTextSSE(response, anthropicStreamDelta, onChunk);
            if (streamResult.text) return streamResult.text;
            // overloaded_error arrives as an error EVENT on a 200 stream, so the
            // status-code retry above never sees it. Wait and ask once more.
            if (!retriedAfterOverload && isBusyErrorPayload(streamResult.streamError)
                && canRetryBeforeDeadline(deadline, OVERLOADED_RETRY_DELAY)) {
                retriedAfterOverload = true;
                console.warn(`[ai] Anthropic-compatible reported "${errorPayloadText(streamResult.streamError)}" mid-stream; retrying once in ${OVERLOADED_RETRY_DELAY / 1000}s`);
                await sleep(OVERLOADED_RETRY_DELAY, signal);
                continue;
            }
            throw streamFailureError("Anthropic-compatible", streamResult, {
                retried: retriedAfterOverload,
                fallbackMessage: "Anthropic-compatible response did not contain text.",
            });
        }

        // A streamed tool call comes back as SSE; readAnthropicStreamedResponse
        // rebuilds the Messages envelope the extractors below already read, so
        // nothing downstream can tell the difference. Branch on what actually
        // arrived, so an endpoint that ignored stream:true still works.
        const data = String(response.headers.get("content-type") || "").includes("text/event-stream")
            ? await readAnthropicStreamedResponse(response, onActivity, onToolStream)
            : await readJsonAnswer(response, "Anthropic Compatible");
        onUsage?.(data);
        if (tool) {
            const toolInput = extractAnthropicToolInput(data, tool);
            if (toolInput) return { rawText: extractAnthropicText(data), toolInput };
            // Not the answer but a question: the model called lookup functions.
            if (lookupDeclarations.length) {
                const lookupCalls = lookupCallsFromAnthropic(data, tool.name);
                if (lookupCalls.length) return { rawText: extractAnthropicText(data), toolInput: null, lookupCalls };
            }

            // Streaming moved the overload refusal from an HTTP status into an
            // error EVENT on a 200, which the status-code retry above cannot see.
            // Without this a provider hiccup costs the player the whole turn.
            if (isBusyErrorPayload(data?.error) && !retriedAfterOverload
                && canRetryBeforeDeadline(deadline, OVERLOADED_RETRY_DELAY)) {
                retriedAfterOverload = true;
                console.warn(`[ai] Anthropic-compatible reported "${errorPayloadText(data.error)}" mid-stream; retrying once in ${OVERLOADED_RETRY_DELAY / 1000}s`);
                await sleep(OVERLOADED_RETRY_DELAY, signal);
                continue;
            }
            // A tool call the stream was cut off partway through: the fragment is
            // logged, never returned as content. Half a turn presented as a whole
            // one is worse than falling back (see jsonSalvage.js).
            if (data?.partialToolJson) {
                logDebugEvent("warn", `[ai] Anthropic-compatible tool call was cut off mid-argument.`, {
                    partialChars: data.partialToolJson.length,
                }, { verbose: true });
            }

            const anthropicText = extractAnthropicText(data);
            // Still refusing: say so, rather than hand back an empty "answer".
            if (!anthropicText && data?.error) throw toolStreamRefusalError("Anthropic Compatible", data.error, retriedAfterOverload);
            // No tool call, and what came back is a planning monologue rather
            // than anything a salvage pass could parse. The proxy accepted
            // tool_choice without enforcing it, so asking again more firmly
            // achieves nothing — change the channel instead. There is only one
            // step down on this API, but it is the step that matters.
            if (structuredMode === "tool" && !insistedOnToolCall
                && looksLikeDeliberation(anthropicText) && canRetryBeforeDeadline(deadline, 0)) {
                insistedOnToolCall = true;
                structuredMode = "text_json";
                console.warn(`[ai] Anthropic Compatible deliberated instead of calling ${tool.name}; dropping from tool to text_json`);
                continue;
            }
            if (anthropicText) {
                noteStructuredModeLanding(observerKey, anthropicStartMode, structuredMode, settings.structuredMode);
            }
            return { rawText: anthropicText, toolInput: null };
        }
        const text = extractAnthropicText(data);

        if (!text) {
            throw new Error("Anthropic-compatible response did not contain text.");
        }

        return text;
    }
}

function dispatchToProvider(provider, systemPrompt, history, providerOpts) {
    switch (provider) {
    case "openai":
        return callOpenAI(systemPrompt, history, providerOpts);
    case "anthropic":
        return callAnthropic(systemPrompt, history, providerOpts);
    case "anthropic-compatible":
        return callAnthropicCompatible(systemPrompt, history, providerOpts);
    case "openai-compatible":
        return callOpenAICompatible(systemPrompt, history, providerOpts);
    case "gemini":
    default:
        return callGemini(systemPrompt, history, providerOpts);
    }
}

// ---------------------------------------------------------------------------
// Conversation logging
// ---------------------------------------------------------------------------
//
// Everything the model is told and everything it says back, for the diagnostics
// log (runtime/debugLog.js). Every call here is `{ verbose: true }`, so with
// detailed logging off it is one boolean test and nothing else; with it on, it
// is the record that makes an advisor or diplomacy bug reproducible — the bugs
// people report on these paths ("it forgot what I told it", "it answered as the
// wrong country", "the letter it drafted is not what was sent") are all about
// the content of an exchange, which a log of the exchange's SHAPE cannot settle.
//
// The system prompt is the exception: it is the whole campaign rendered through
// a template, tens of thousands of characters, and one of them would evict
// everything around it even from the enlarged detailed-mode budget. Its size is
// logged instead — enough to catch the case where it came out empty or absurd —
// while the messages either side of it go in whole.
const conversationChars = (history) => (Array.isArray(history) ? history : [])
    .reduce((total, entry) => total + (entry?.parts ?? [])
        .reduce((sum, part) => sum + String(part?.text ?? "").length, 0), 0);

const conversationShape = (systemPrompt, history) => ({
    systemPromptChars: String(systemPrompt ?? "").length,
    historyMessages: Array.isArray(history) ? history.length : 0,
    historyChars: conversationChars(history),
});

const elapsedSeconds = (startedAt) => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

// Lookup rounds (lookupTools.js, toolTurns.js). A structured task may hand
// callAI `lookups: { tools, execute, maxRounds?, onRound? }`: the lookup
// functions are declared beside the task's output function, and when the model
// calls them instead of answering, each call is answered here (from the live
// campaign, by the task's executor) and the exchange goes back as the next
// turns of the same conversation. That repeats until the model calls the
// output function, or the round budget is spent and the final request is made
// with only the output function callable. One provider request per round; the
// system prompt is byte-identical across rounds, so a cached prefix pays off.
// Three, not more: every round re-sends the whole prompt, and a model that
// asks one question per round spent seven rounds and three hundred thousand
// prompt tokens on one jump. The directive tells it to ask everything at once.
const DEFAULT_LOOKUP_ROUNDS = 3;

// Every round the model spends asking is reported to `onRound` — callAI
// writes it to the telemetry record and the diagnostics log — so "what did
// the model look up before it answered" is answerable from the console.
async function runWithLookups(lookups, history, dispatch, { label, provider, onRound = null }) {
    const tools = Array.isArray(lookups?.tools) ? lookups.tools.filter((entry) => entry?.name && entry?.schema) : [];
    if (!tools.length || typeof lookups?.execute !== "function") return dispatch(history, {});
    const maxRounds = Number.isInteger(lookups.maxRounds) && lookups.maxRounds >= 0 ? lookups.maxRounds : DEFAULT_LOOKUP_ROUNDS;
    let conversation = Array.isArray(history) ? history : [];
    let roundStartedAt = Date.now();
    for (let round = 0; ; round += 1) {
        const requireOutputTool = round >= maxRounds;
        if (round > 0) lookups.onRound?.(round);
        const result = await dispatch(conversation, { lookupTools: tools, requireOutputTool });
        const calls = Array.isArray(result?.lookupCalls) ? result.lookupCalls : [];
        // The answer, or a request that could not be turned into one (a final
        // round still asking questions falls through to the runner's retry).
        if (!calls.length || result?.toolInput || requireOutputTool) {
            if (round > 0) {
                logDebugEvent("ai-call", `${label}: ${provider} answered after ${round} lookup round${round === 1 ? "" : "s"}${result?.toolInput ? "" : " without calling the output function"}.`,
                    { lookupRounds: lookupRoundCount(conversation), answered: Boolean(result?.toolInput), forcedOutput: requireOutputTool });
            }
            return result;
        }
        const elapsedMs = Date.now() - roundStartedAt;
        const results = [];
        const answered = [];
        for (const call of calls) {
            const startedAt = Date.now();
            let response;
            try {
                response = await lookups.execute(call.name, call.args);
            } catch (error) {
                response = { error: String(error?.message || error) };
            }
            if (response == null || typeof response !== "object" || Array.isArray(response)) response = { result: response ?? null };
            results.push({ id: call.id, name: call.name, response });
            answered.push({
                name: call.name,
                args: call.args,
                label: describeLookupCall(call),
                response: JSON.stringify(response),
                ms: Date.now() - startedAt,
                error: typeof response.error === "string" && response.error.length > 0,
            });
        }
        // Always logged: the calls and what they cost, one line. The full
        // arguments and answers ride along only in detailed mode.
        logDebugEvent("ai-call", `${label}: lookup round ${round + 1} on ${provider}: ${answered.map((entry) => entry.label).join("; ")}.`, {
            answers: answered.map((entry) => `${entry.name} ${entry.error ? "ERROR " : ""}${entry.response.length} chars`).join("; "),
            modelMs: elapsedMs,
        });
        logDebugEvent("ai-call", `${label}: lookup round ${round + 1} in full.`, answered.map((entry) => ({
            call: entry.label, args: entry.args, response: entry.response,
        })), { verbose: true });
        try {
            onRound?.({ round: round + 1, calls: answered, elapsedMs });
        } catch (error) {
            console.warn("[ai] a lookup-round observer threw; continuing.", error);
        }
        conversation = appendLookupRound(conversation, calls, results);
        roundStartedAt = Date.now();
    }
}

// A call that failed without the provider saying why, because it never reached
// the provider at all (isUnreachableError).
const asUnreachable = (error, signal) => {
    if (error?.providerFailure || signal?.aborted || error?.name === "AbortError") return error;
    if (isUnreachableError(error)) error.providerFailure = { kind: "busy", reason: "could not be reached" };
    return error;
};

// What happened to an entry, in the words a Settings row and a notice use.
const describeFailure = (entry, failure) => {
    switch (failure?.kind) {
    case "spent": return entry.provider === "gemini" ? "has used today's allowance" : "has used its allowance";
    case "unusable": return `can't be used: ${failure.reason}`;
    case "rateLimited": return "is rate limited";
    case "tooBig": return `cannot take a request this size (${failure.reason})`;
    default: return failure?.reason === "could not be reached" ? "could not be reached" : "is busy";
    }
};

// Every mark, into the Diagnostics log with when it clears: a turn answered by
// three models is otherwise impossible to read back. A request passed over for
// its size leaves no mark (`state` null): the entry is skipped for this request only.
function logFallbackMark(label, entry, failure, state) {
    const clears = !state
        ? "for this request only"
        : state.unusable
            ? "until it is edited"
            : `until ${formatResetTime(state.spentUntil ?? state.skipUntil)}`;
    logDebugEvent("ai", `${label}: Fallback list — ${entry.label} ${describeFailure(entry, failure)}; skipped ${clears}.`, {
        provider: entry.provider,
        kind: failure.kind,
        reason: failure.reason || "(none given)",
    }, { problem: failure.kind === "unusable" });
}

// Once per switch, not once per call (the runner only reports the entries a
// call marked itself). The game UI shows it as a short notice.
// `to` is null when nothing below answered either: the notice then says only
// what ran out, and the call's own error says the rest.
function announceFallbackSwitch({ skipped, to }) {
    const lost = skipped.map(({ entry, failure }) => `${entry.label} ${describeFailure(entry, failure)}`).join("; ");
    const message = to ? `${lost}. Now using ${to.label}.` : `${lost}.`;
    logDebugEvent("ai", `Fallback list: ${message}`);
    try {
        window.dispatchEvent(new CustomEvent("ai:fallback-switch", { detail: { message } }));
    } catch { /* no window (tests, the harness) — the log line stands */ }
}

export async function callAI(systemPrompt, history, opts = {}) {
    // Non-English players get replies in their language at the source —
    // native answers beat post-translating them (see runtime/i18n.js).
    //
    // `logLabel` names the conversation this call belongs to ("advisor",
    // "diplomacy → France", a gameplay task key) so the transport entries below
    // line up with the message entries their callers write. It is stripped here
    // alongside languageMode because it is ours: no provider function should
    // ever see it, and callGemini would silently drop it anyway.
    // `__debug` (task, attempt, simulated days) and `__debugSink` (where the
    // task runner wants the record back, to attach the validation outcome)
    // are ours too, and stripped for the same reason.
    // `lookups` is ours as well: the loop above runs it, the providers only
    // ever see the per-round `lookupTools` / `requireOutputTool` it derives.
    // `requestKind` says whether the player asked for this call or the game made
    // it in the background, and `onRequest` lets the caller count along (a time
    // skip reports what it cost): both are for the request budget below.
    const {
        languageMode = "ui", logLabel = "", __debug: debugMeta = null, __debugSink: debugSink = null, lookups = null,
        // Developer/evaluation harness hooks. They are stripped here and never
        // reach a provider. __forceEntryId pins one exact Fallback-list entry so
        // paired A/B runs cannot silently compare different models. __capture
        // receives the exact request/response metrics even when telemetry is off.
        __capture: capture = null, __forceEntryId: forceEntryId = "",
        requestKind = PLAYER_REQUEST, onRequest: observeRequest = null,
        ...providerOpts
    } = opts;
    const directive = languageMode === "none" ? ""
        : languageMode === "chat" ? chatLanguageDirective()
        : languageDirective();
    if (directive) {
        systemPrompt = `${systemPrompt}\n\n${directive}`;
    }

    const resolvedRouting = resolveTaskFallbackEntries(providerOpts.taskKey);
    let entries = resolvedRouting.entries;
    let preferredEntryId = resolvedRouting.preferredEntryId;
    const pinnedId = String(forceEntryId ?? "").trim();
    if (pinnedId) {
        const pinned = entries.find((entry) => entry.id === pinnedId);
        if (!pinned) throw new Error(`The selected AI entry (${pinnedId}) is no longer in the Fallback list.`);
        entries = [pinned];
        preferredEntryId = pinned.id;
    }
    // Named for where the call STARTS; the answer names who actually answered.
    const firstChoice = entries.find((entry) => entry.id === preferredEntryId) ?? entries[0];
    const provider = firstChoice?.provider ?? "(none)";
    const label = logLabel || "AI call";
    const startedAt = Date.now();
    if (capture && typeof capture === "object") {
        capture.startedAt = startedAt;
        capture.taskKey = providerOpts.taskKey ?? (logLabel || "direct");
        capture.requestedEntryId = pinnedId || preferredEntryId || firstChoice?.id || "";
        capture.systemPrompt = systemPrompt;
        capture.history = Array.isArray(history)
            ? history.map((entry) => ({ role: entry?.role, parts: Array.isArray(entry?.parts) ? entry.parts.map((part) => ({ text: String(part?.text ?? "") })) : [] }))
            : [];
        capture.userMessage = Array.isArray(history) ? String(history.at(-1)?.parts?.[0]?.text ?? "") : "";
        capture.requests = [];
    }
    // Telemetry (Settings → AI debug console): one record per call — prompt,
    // answer, model, usage, latency — in memory and, while recording is on, in
    // IndexedDB. A task-runner call is judged by its validator afterwards, so
    // it stays "pending" until that outcome lands through the sink.
    const record = isTelemetryEnabled()
        ? startAiRecord({
            ...(debugMeta && typeof debugMeta === "object" ? debugMeta : {}),
            taskKey: debugMeta?.taskKey ?? providerOpts.taskKey ?? (logLabel || "direct"),
            provider,
            systemPrompt,
            userMessage: Array.isArray(history) ? history.at(-1)?.parts?.[0]?.text ?? "" : "",
            staticPrefixEnd: providerOpts.staticPrefixEnd ?? null,
            awaitingOutcome: Boolean(debugSink),
        })
        : null;
    if (debugSink && typeof debugSink === "object") debugSink.record = record;
    const callShape = {
        ...conversationShape(systemPrompt, history),
        streaming: Boolean(providerOpts.onChunk),
        tool: providerOpts.tool?.name || "(none — raw JSON expected)",
        lookupTools: Array.isArray(lookups?.tools) ? lookups.tools.length : 0,
        maxTokens: providerOpts.maxTokens ?? "(provider maximum)",
        reasoning: getReasoningEnabled(),
    };

    // What the call actually cost, and how long it sat before answering.
    //
    // Character counts have always been logged, but prose, JSON schema and
    // campaign state tokenize at visibly different rates, so they cannot tell a
    // real saving from noise. TTFB matters separately: it isolates prompt
    // evaluation — the part a stable prompt prefix makes nearly free — from
    // generation, which no amount of prompt work speeds up.
    //
    // The timer wraps the caller's own onActivity (runJsonTask passes the idle
    // watchdog's note()), so it observes the first chunk without displacing it.
    const timer = createFirstByteTimer(providerOpts.onActivity);
    // The request budget (requestBudget.js): every response any provider path
    // gets is one request against the player's daily allowance, so it is counted
    // HERE, under the lookup rounds, the retries and the Fallback list, rather
    // than per call — one callAI can be many requests. The ledger must never
    // cost a call its answer.
    const noteRequest = (status) => {
        if (capture && typeof capture === "object") capture.requests?.push(status);
        try {
            requestLedger.note({
                status,
                kind: requestKind === BACKGROUND_REQUEST ? BACKGROUND_REQUEST : PLAYER_REQUEST,
                taskKey: debugMeta?.taskKey ?? providerOpts.taskKey ?? (logLabel || "direct"),
            });
            observeRequest?.(status);
        } catch (error) {
            console.warn("[ai] the request count could not be updated; continuing.", error);
        }
    };
    // Summed across the rounds of a lookup conversation (each round is a
    // whole request); the latest round's own figure is what a lookup round
    // is recorded with.
    let usage = null;
    let roundUsage = null;
    let lookupRounds = 0;
    let lookupCalls = 0;

    // The context preflight (contextWindow.js). How big this request is, in
    // tokens as near as four characters a token can say; an entry whose window
    // is known to be too small for it is passed over WITHOUT a request, and one
    // that refuses it teaches its window for next time.
    const requestTokens = estimateTokens(requestChars({
        systemPrompt,
        history,
        tools: [providerOpts.tool, ...(Array.isArray(lookups?.tools) ? lookups.tools : [])].filter(Boolean),
    }));
    const answerReserve = Number(providerOpts.maxTokens) > 0 ? Number(providerOpts.maxTokens) : DEFAULT_ANSWER_RESERVE_TOKENS;
    const rememberContextWindow = (entry, error) => {
        const failure = error?.providerFailure;
        if (failure?.kind !== "tooBig") return;
        try {
            const stated = parseContextWindowError(failure.reason);
            const learned = contextWindows.learn(contextWindowKey(entry), {
                limitTokens: stated.limitTokens,
                requestTokens: stated.requestedTokens ?? requestTokens,
            });
            logDebugEvent("ai", `${label}: ${entry.label} refused the request as too big for its context window; `
                + (learned?.limitTokens ? `its window is ${learned.limitTokens} tokens, remembered.` : `a request of ~${requestTokens} tokens is remembered as too big for it.`),
                { reason: failure.reason, requestTokens }, { problem: true });
        } catch (memoryError) {
            console.warn("[ai] the model's context window could not be remembered; continuing.", memoryError);
        }
    };

    const requestScope = beginAiRequestScope(providerOpts.signal);
    providerOpts.signal = requestScope.signal;

    try {
        // The Fallback list (fallbackRunner.js): the task's own pick first,
        // then the list from the top, moving down only past an entry that is
        // Spent, Unusable or busy — or one this request cannot fit. Each attempt
        // runs the whole lookup conversation (runWithLookups) against that one entry.
        const { result, entry: answeredBy } = await runWithFallback({
            entries,
            preferredEntryId,
            store: fallbackStateStore,
            rateLimitPolicy: getRateLimitPolicy(),
            onChunk: providerOpts.onChunk,
            canAttempt: (entry) => contextWindows.refusal(contextWindowKey(entry), requestTokens, { reserveTokens: answerReserve }),
            tooBigError: (refused) => providerFailureError(
                nothingFitsMessage(refused.map(({ entry, reason }) => ({ label: entry.label, reason })), requestTokens),
                { kind: "tooBig", reason: "no entry in the Fallback list can fit this request" },
            ),
            attempt: (entry, { canFallBack, onChunk }) => {
                if (record) record.provider = entry.provider;
                logDebugEvent("ai-call", `${label}: request to ${entry.label} [${entry.provider}] (~${requestTokens} tokens).`, callShape, { verbose: true });
                return runWithLookups(lookups, history, (roundHistory, roundOpts) => dispatchToProvider(entry.provider, systemPrompt, roundHistory, {
                    ...providerOpts,
                    ...roundOpts,
                    onChunk,
                    entrySettings: entry,
                    canFallBack,
                    rateLimitPolicy: getRateLimitPolicy(),
                    onActivity: timer.note,
                    onRequest: noteRequest,
                    onUsage: (data) => {
                        const reported = normalizeUsage(data);
                        if (!reported) return;
                        roundUsage = reported;
                        usage = sumUsage(usage, reported);
                    },
                    // The model the provider actually resolved (overrides, discovery).
                    onModel: (model) => {
                        if (record) record.model = String(model ?? "");
                        if (capture && typeof capture === "object") capture.model = String(model ?? "");
                    },
                }).catch((error) => { rememberContextWindow(entry, error); throw asUnreachable(error, providerOpts.signal); }), {
                    label,
                    provider: entry.provider,
                    onRound: ({ round, calls, elapsedMs }) => {
                        lookupRounds = round;
                        lookupCalls += calls.length;
                        attachLookupRound(record, { round, calls, elapsedMs, usage: roundUsage });
                        roundUsage = null;
                    },
                });
            },
            onMark: ({ entry, failure, state }) => logFallbackMark(label, entry, failure, state),
            onSwitch: announceFallbackSwitch,
            formatTime: formatResetTime,
        });
        logDebugEvent("ai-call", `${label}: ${answeredBy.label} [${answeredBy.provider}] answered in ${elapsedSeconds(startedAt)}.`, {
            replyChars: typeof result === "string" ? result.length : String(result?.rawText ?? "").length,
            viaToolCall: Boolean(result?.toolInput),
            ...(lookupRounds ? { lookupRounds, lookupCalls } : {}),
            // Omitted rather than zeroed when unknown: a buffered call never
            // fires onActivity, and plenty of gateways report no usage at all.
            ...(timer.firstByteMs === null ? {} : { firstByteMs: timer.firstByteMs }),
            ...(usage ?? {}),
        }, { verbose: true });
        attachCallMetrics(record, { usage, firstByteMs: timer.firstByteMs });
        const capturedRawResponse = typeof result === "string"
            ? result
            : String(result?.rawText ?? "") || (result?.toolInput ? JSON.stringify(result.toolInput) : "");
        finishAiRecord(record, {
            ok: true,
            rawResponse: capturedRawResponse,
        });
        if (capture && typeof capture === "object") {
            capture.ok = true;
            capture.endedAt = Date.now();
            capture.latencyMs = Math.max(0, capture.endedAt - startedAt);
            capture.firstByteMs = timer.firstByteMs;
            capture.provider = answeredBy?.provider || firstChoice?.provider || "";
            capture.entryId = answeredBy?.id || firstChoice?.id || "";
            capture.entryLabel = answeredBy?.label || firstChoice?.label || "";
            capture.model = capture.model || answeredBy?.model || firstChoice?.model || "";
            capture.usage = usage && typeof usage === "object" ? { ...usage } : null;
            capture.lookupRounds = lookupRounds;
            capture.lookupCalls = lookupCalls;
            capture.rawResponse = capturedRawResponse;
            capture.viaToolCall = Boolean(result?.toolInput);
        }
        return result;
    } catch (error) {
        // NOT verbose-only. A call that failed is the thing a bug report is most
        // often about, and it is invisible otherwise on the chat paths — the
        // advisor and diplomacy UIs render the error into the transcript and
        // never console.error it, so nothing else would record that it happened.
        // A cancelled call is held back for detailed mode because it is not a
        // failure at all: the player pressed the button.
        const cancelled = error?.name === "AbortError";
        logDebugEvent("ai-call",
            `${label}: ${cancelled ? "call cancelled" : "call FAILED"} after ${elapsedSeconds(startedAt)}${error?.fallbackUnavailable ? " — nothing in the Fallback list can answer" : ""}.`,
            error,
            { verbose: cancelled });
        attachCallMetrics(record, { usage, firstByteMs: timer.firstByteMs });
        finishAiRecord(record, { ok: false, error: cancelled ? "cancelled" : String(error?.message || error) });
        if (capture && typeof capture === "object") {
            capture.ok = false;
            capture.endedAt = Date.now();
            capture.latencyMs = Math.max(0, capture.endedAt - startedAt);
            capture.firstByteMs = timer.firstByteMs;
            capture.usage = usage && typeof usage === "object" ? { ...usage } : null;
            capture.error = cancelled ? "cancelled" : String(error?.message || error);
        }
        throw error;
    } finally {
        requestScope.finish();
    }
}

let promptPack = normalizePromptPack({});
let promptsReady = null;
let promptsReadyKey = "";

async function ensurePromptsLoaded() {
    // The guidance passages arrive in the player's language a moment after boot
    // (runtime/promptTranslations.js); a pack composed before then is recomposed.
    const cacheKey = `${JSON_URLS.prompts}|${promptTranslationsVersion()}`;

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
        // What this prompt is allowed to have READ. A leader speaks as one polity
        // and may only see chats that polity was in; the advisor passes no
        // speakingAs and therefore sees everything, which is correct — it is the
        // player's own staff, and the player is in every chat.
        chatVisibleTo: speakingAs,
    });
}

// Lets the advisor create/edit/remove the player's queued Actions (the same
// queue the Actions panel manages) as part of an ordinary chat reply, instead
// of only through the separate "Get AI suggestions" flow. Appended at call
// time (not baked into defaultPrompts.json's `advisor` text) so it reaches
// games that carry their own frozen/scenario-authored advisor prompt too —
// see the frozen-prompt caveat in gameplay.js's runJsonTask.
const buildAdvisorActionsDirective = (plannedActionsWithIds) => `[Action Planning]
You can create, edit, or remove the player's queued Actions directly from this conversation — the same queue the Actions panel manages, with no separate confirmation step. Because of that, only propose actions the two of you have actually settled on together in this conversation; never invent or queue one on your own initiative from an open-ended question, and never re-propose something the player already turned down.

To act, end your reply with a fenced \`\`\`actions block containing a JSON array (in ADDITION to your normal prose reply — always also say in plain text what you're proposing or changed; the array itself is stripped from what the player sees). Each entry:
- Create: {"title":"...","text":"...","kind":"action"} — kind is "action" unless it's specifically a diplomatic outreach, then "chat".
- Edit an existing one: {"id":"<exact id copied from the list below>","title":"...","text":"..."} — only the fields you include change.
- Remove an existing one: {"id":"<exact id copied from the list below>","remove":true}.
IDs must be copied EXACTLY from [Current Planned Actions] below — never invented or guessed. Omit the \`\`\`actions block entirely when nothing should change (most replies need none).

Internal acts belong HERE, not on the Projects board: renaming or recolouring the country, a new flag, style, title or anthem, a redesignated capital, a proclamation, a ministry reshuffle. Each is a single decision by a government that needs nobody else's consent, it takes effect at the next time skip, and opening a project for one leaves the player watching a progress bar instead of getting what they asked for. Queue it as an action, say plainly when it takes effect, and say what will visibly change (the map label, the country panel, the border). A transfer of territory belongs here too WHEN the other side has already agreed to it, or the ground has already been taken and held — but a contested one does not: that is a project, and you should say what is missing rather than promise it.

Example:
\`\`\`actions
[{"title":"Reinforce the eastern border","text":"Deploy two additional divisions to reinforce the frontier garrisons before the thaw."}]
\`\`\`

[Current Planned Actions]
${plannedActionsWithIds}`;

// Lets the UI offer a real "Send message to X" button for a drafted diplomatic
// message instead of the player copy-pasting your blockquote into the
// Diplomacy panel themselves. Appended at call time for the same frozen-prompt
// reason as buildAdvisorActionsDirective above.
//
// Deliberately does NOT ask the model to retype the letter's text into the
// JSON field — an earlier version did, and asking a model to duplicate
// arbitrary prose verbatim inside a JSON string is exactly the kind of thing
// that silently breaks: one unescaped quote (very likely in diplomatic prose)
// or one real line break (very likely in a multi-paragraph letter) makes the
// fence invalid JSON, which advisor.jsx's extractFencedJson discards without
// a trace — the button just never appears, with nothing to explain why. The
// JSON now carries only the explicit destination identity, and advisor.jsx
// pulls the actual text back out of the blockquote itself, positionally.
const ADVISOR_MESSAGE_DRAFT_DIRECTIVE = `[Drafting Messages to Send]
Whenever you draft an actual diplomatic message the player could send right now — not a summary or paraphrase, but the literal message text — write it as a markdown blockquote (a line starting with "> "), and quote nothing else in the reply that way. Immediately after all such blockquotes, append one fenced \`\`\`senddraft block containing a JSON array with one entry per drafted message, in the SAME ORDER the blockquotes appear. Do not repeat the message text in JSON.

Every draft MUST carry an explicit destination:
- Private bilateral: {"targetType":"private","country":"<exact recipient polity name>"}.
- Institution Council: {"targetType":"institution-council","institutionId":"<exact institution id>","country":"<optional display recipient>"}.
- Institution lifecycle/accession hearing: {"targetType":"institution-lifecycle","institutionId":"<exact institution id>","caseId":"<exact lifecycle case id>","country":"<counterparty display name>"}.

Use only exact ids exposed in [Current Diplomatic & Institutional Options]. NEVER omit targetType for an institutional message and NEVER assume the current/latest diplomacy chat is the destination. If you are drafting ordinary bilateral correspondence, targetType must be "private" even when that polity also shares an institution with the player. Omit the block entirely when you have not drafted a sendable message this turn.

Example:
> Your Excellency, I write to propose a mutual non-aggression pact between our nations...
\`\`\`senddraft
[{"targetType":"private","country":"France"}]
\`\`\``;

// Formal institution business is separate from diplomatic prose. The Advisor
// may prepare an exact action, but it never executes merely because the model
// recommends it: advisor.jsx renders a confirmation button and the native
// institution runtime revalidates the player's authority on click.
const ADVISOR_INSTITUTION_DRAFT_DIRECTIVE = `[Drafting Formal Institution Actions]
When you recommend a concrete formal institutional step that the player can legally take RIGHT NOW, normally append one fenced \`\`\`institutiondraft block containing a JSON array in the SAME reply instead of stopping at "formal execution is your prerogative". This is a DRAFT ONLY: the game shows the player a confirmation button and native governance revalidates everything before execution. Never say the act has happened merely because you drafted it.

Allowed draft shapes:
- Table a new agenda resolution: {"type":"table-proposal","institutionId":"<exact id>","proposalType":"resolution","title":"<short title>","summary":"<what the institution should decide>"}
- Submit an EXISTING player-sponsored proposal for formal voting: {"type":"submit-proposal","institutionId":"<exact id>","proposalId":"<exact existing proposal id>"}
- Cast the player's ballot on an EXISTING open proposal: {"type":"vote","institutionId":"<exact id>","proposalId":"<exact existing proposal id>","choice":"yes|no|abstain|veto","reason":"<optional rationale>"}
- Send a membership invitation through the institution lifecycle: {"type":"invite","institutionId":"<exact id>","polity":"<exact target polity name>","requestedStatus":"member|observer|associate|participant","reason":"<optional rationale>"}

Use ONLY exact institution/proposal ids and current affordances exposed in [Current Diplomatic & Institutional Options]. Do not invent an id or a ballot that is not open. Do not use this block for ordinary Council speech; that uses senddraft. Do not silently combine multiple legal stages: if a proposal must first be tabled and only later submitted for voting, draft the currently legal next step. For accession, follow the charter's lifecycle rather than inventing a pre-vote when the actual next step is an invitation. Omit the block when there is no formal player action to prepare.

Example:
\`\`\`institutiondraft
[{"type":"table-proposal","institutionId":"mitteleuropa","proposalType":"resolution","title":"Danube Transport Coordination","summary":"Adopt a common Mitteleuropa framework for cross-border rail scheduling and customs clearance."}]
\`\`\``;

// The advisor has always been handed the whole world's unit list, but under a
// heading reading "Player polity, X, details: ... Military Units:" — so it read
// them as the player's own army and never used them to answer a question about
// anyone else. defaultPrompts.json now frames it properly for new games; this is
// what reaches the campaigns whose advisor prompt is already frozen.
const buildAdvisorForcesDirective = (forcePosture) => `[Forces on the Map]
This is EVERY power's forces, not just the player's — what your services can see of the world's armies, fleets and squadrons, including where each one is, what it is doing, whose territory it is in or how far from whose border, and what it is already under orders to do. Use it whenever the player asks about anyone's military position, their own or a rival's. Answer like an intelligence chief: name the formations, say what they are doing and how close they are to what, and say plainly what you think it means. A formation marked unconfirmed has been detected without a known line of support — treat it as real, but say confidence is limited.
${forcePosture}`;

// Lets the advisor turn "put two divisions on the eastern frontier" into a real
// button that places the unit, instead of the player reading coordinates off the
// screen and clicking the map themselves. Appended at call time for the same
// frozen-prompt reason as the two directives above.
// The advisor must not offer what the UI cannot deliver: the player places
// formations and states intent for them, and never moves or fights them by hand.
const ADVISOR_DEPLOY_DIRECTIVE = `[Placing Forces]
The player can place their own formations on the map; they cannot move or fight them, so never offer to march or attack with anything. When you specifically recommend placing a NEW formation of theirs somewhere, and you know where, append a fenced \`\`\`deploy block after your normal prose (never instead of it) containing a JSON array with one entry per recommended deployment: {"type":"infantry|armor|air|naval|artillery|garrison","name":"<what to call it>","composition":"<what it is made of, e.g. 2 frigates>","strength":<1-100, percent of established strength>,"lng":<real longitude>,"lat":<real latitude>}.
Use real coordinates for the place you are actually recommending — 0,0 is open ocean and is never valid. Omit the block entirely unless you are recommending a specific placement at a specific place; most replies need none, and a general discussion of strategy is not a deployment. Anything the player places is a REQUEST: the simulation confirms, repositions or rejects it, so say so rather than promising it will stand.

Example:
\`\`\`deploy
[{"type":"armor","name":"3rd Guards Division","composition":"2 tank regiments","strength":100,"lng":30.52,"lat":50.45}]
\`\`\``;

// What the advisor's prose is allowed to look like.
//
// Its replies are rendered as GitHub-flavoured markdown (src/Game/GameUI/markdown.jsx),
// and until that renderer grew tables the model had no way to lay anything out —
// so it improvised, and the player saw the improvisation raw: literal <br> tags
// where it wanted a line break, and pipe-and-dash tables that never parsed. It
// now has a real vocabulary, and this is where it is told what is in it and what
// each part is FOR. Appended at call time for the same frozen-prompt reason as
// the directives above: the campaigns that most need this already carry their
// own copy of the advisor prompt.
//
// The two prohibitions matter more than the permissions. Raw HTML is not
// rendered (deliberately — this is model output going into the DOM), so a tag is
// always visible as text. And "> " blockquotes are load-bearing elsewhere:
// ADVISOR_MESSAGE_DRAFT_DIRECTIVE reads the drafted letter back OUT of the
// blockquote positionally, so a blockquote used for emphasis becomes a "send
// this to France" button attached to something that was never a message.
const ADVISOR_FORMATTING_DIRECTIVE = `[How Your Replies Are Displayed]
Your prose is rendered as GitHub-flavoured markdown in a narrow side panel, so you can lay a reply out properly. Use that, but use it lightly: most replies are a few short paragraphs and need no structure at all, and a briefing that is all headings and tables reads like a form rather than like counsel.

What you have:
- **Bold** for the figure or name that matters, *italics* sparingly for emphasis, ~~strikethrough~~ for something now superseded, and \`inline code\` for an exact designation or codename.
- ## Headings and ### subheadings to divide a genuinely long reply into sections. #### renders as a small label — use it for a one-line heading over a short block. A reply under about six lines needs no heading whatsoever.
- Bullet lists with "- ", numbered lists with "1.", nested by indenting two spaces. Checklists with "- [ ] " for things not yet done and "- [x] " for things done.
- A "---" rule between two major parts of a long briefing. At most one or two in a reply.
- Tables, for genuinely tabular data ONLY — several items compared on the SAME few fields (fleets by strength and station, projects by progress and date, powers by stance). A table needs at least two columns AND at least two rows to be worth making. Keep it to two to four columns with short cells: the panel is narrow and a wide table has to be scrolled.

Every row must have a real value in EVERY column. A column you leave blank down the whole table still takes its share of a narrow panel and gives the player nothing.

When NOT to use a table: never to describe a single thing. One item's explanation is a paragraph, or a bolded label with prose after it — a two-column "Item / Detail" table with one row is worse than the sentence it replaces. If a cell would hold more than a short phrase, it is prose, not a table. And if you find the whole answer going into the first cell of each row while the other columns sit empty, the table was the wrong shape from the start: write it as a bulleted list instead, one bullet per item, the name in bold and the explanation after a dash.

Two hard rules:
- No HTML, ever. Tags are not rendered, so the player sees the literal text "<br>". For a line break, press return and write the next line; for a gap between paragraphs, leave a blank line.
- Never use a "> " blockquote for emphasis, for quoting the player back, or for a nice-looking pull quote. A blockquote means one thing in this conversation: the text of a diplomatic message the player can send, per [Drafting Messages to Send]. Anything else you put in one becomes a send button on something that was never a letter.

Example of a table that earns its place:

| Programme | Progress | Next milestone |
|---|---|---|
| Titan (Highlands) | 71% | Sea trials, Nov |
| Hyperion Mk II | 34% | Core delivery, Jan |`;

// Lets the advisor open and maintain the player's Projects & Operations board
// from an ordinary chat reply, the same way the ```actions block manages the
// action queue. Appended at call time for the same frozen-prompt reason as the
// directives above: every save carries its own copy of the prompt pack, so a
// defaultPrompts.json edit would only ever reach NEW games — and the single most
// important thing this feature has to do is populate the board of a campaign
// that is already fifty rounds deep.
//
// The player cannot create a project by hand anywhere in the UI. That is
// deliberate (the board reflects the narrative, not a wishlist), but it does mean
// that if the advisor never opens one, nothing will — hence the instruction to
// open one whenever a sustained effort is actually settled on, rather than
// waiting to be asked.
const buildAdvisorProjectsDirective = (projectsSummary) => `[Projects & Operations]
The player has a Projects & Operations board: the running list of their long-term efforts — research and industrial programmes, construction projects, military and covert operations, sustained political campaigns — each with a description, tags, progress, timeline and next milestone. They can read, sort and filter it, and on THEIR OWN entries set a priority or abandon one outright, but they cannot create an entry or write its content, and they hold neither lever over another power's programme (see [Whose project it is]). You and the world's events are the only things that author what a project IS. A project the player has marked HIGH PRIORITY is one they want moved: brief them on it first and unprompted, and chase it when it goes quiet. One marked low priority may be left alone unless they ask. An abandoned project is closed, and you must not re-open it on your own initiative — but if the player explicitly asks you to resume it, do so: reactivate it with op update and status active, or open a fresh entry, and say plainly that is what you have done. Never set a priority yourself unless they have asked you to in this conversation.

You can create, update and close entries directly from this conversation, with no separate confirmation step. Because of that, only open a project once the two of you have actually settled on a sustained effort — never speculatively from an open-ended question, and never re-open one the player has abandoned. Do open one unprompted when it is clearly warranted: if they commit to something that will run for rounds, it belongs on the board, and nothing else will put it there.

[Whose project it is]
Roughly half a mature board is not the player's. A foreign power's programme sits there because their services have learned of it, and it is marked THEIRS in the list below; anything not so marked is the player's own. The difference is not decoration:
- The player's OWN efforts they may steer. They set the priority, and they may abandon one outright. Do as they ask with their own work.
- A FOREIGN effort they may only watch. They do not set its priority, they cannot call it off, and neither can you on their say-so. If they tell you to cancel, shelve, deprioritise or reprioritise another government's programme, REFUSE it plainly in one sentence — that is not a lever anyone here holds — and send no op for it. Do not quietly comply, and do not pretend to: a cancel op you send for a rival's shipyard would close it on the board and the player would believe their word did it.
- What you may do instead is the useful half of the answer, and you should offer it in the same breath: they cannot stop another power's programme by wishing it, but they can DO something about it. Sabotage, a covert operation, diplomatic pressure, an export ban, buying up the supply, or simply outbuilding them — that is the player's OWN effort against a foreign one, it is theirs to command, and it belongs on the board as a new entry of theirs (no ownerCode). Open it once they actually settle on it, and say plainly that what you have opened is our operation against their programme, not a change to their programme.
- You still UPDATE foreign entries freely, because that is what they are for: new intelligence, revised progress, a milestone their services have observed, a programme that has evidently finished or collapsed. That is reporting, and it is your job. What you must not do is act on one as though the player commanded it.
Retaliation is the one case worth naming twice, because it looks like an exception and is not. "They sabotaged ours, so wreck theirs" is a legitimate order — but the thing it opens is OUR operation to wreck theirs, an entry of the player's own with its own progress and its own way of failing. Their programme keeps running on the board until something actually stops it, and what stops it is an event, not our intention.

[What does not belong on the board]
The board is for work that genuinely runs for rounds and can fall behind. Three things are not that, and putting one here is worse than doing nothing, because the player then watches a progress bar instead of getting what they asked for:
- Internal acts. Renaming or recolouring the country, a new flag, style, title or anthem, a redesignated capital, a proclamation, a ministry reshuffle, the administration of land they already hold. These are one signature by a government that needs nobody's permission. They are ACTIONS — queue them in your \`\`\`actions block, tell the player they take effect at the next time skip, and say what will visibly change when they do (the map label, the country panel).
- Anything the player has asked you to simply do. A request is not a programme.
- Single decisions and one-off events. Signing something already agreed, a speech, a state visit, a purchase already funded.
Territory is the one that needs judgement. Handing a region over is immediate too WHEN the other side has already agreed to it, or when the ground has already been taken and held — a settled hand-over needs no programme. It is only a project when it is genuinely contested: then the campaign to obtain the consent or the ground is the project, the transfer itself rides on its onComplete, and the world's events will mark the territory disputed in the meantime.
A project needs all three of: it takes months or years, it can be measured, and it can go wrong. If you cannot name a plausible milestone six months out, it is not a project. When you are unsure, the answer is an action.

To act, end your reply with a fenced \`\`\`projects block containing a JSON array (in ADDITION to your normal prose reply — always also say in plain text what you opened or changed; the array itself is stripped from what the player sees). Each entry:
- Open one: {"op":"create","name":"Project Leviathan","summary":"...","kind":"project","tags":["military","naval"],"status":"active","progress":0,"targetDate":"YYYY-MM-DD","milestones":[{"title":"...","date":"YYYY-MM-DD"}]} — kind is "operation" for a military, intelligence or covert undertaking and "project" for a programme or build. Add "secrecy":"covert" for something deniable, and "ownerCode":"<full country name>" for a FOREIGN power's programme you have learned of (omit it entirely for the player's own).
- Change one: {"op":"update","id":"<exact id from the list below>","name":"<its exact name>","progress":58,"status":"stalled","lastUpdate":"One sentence on what just changed."} — send only the fields that actually change.
- Record a checkpoint: {"op":"milestone","id":"<exact id>","name":"<its exact name>","milestone":{"title":"Sea trials","date":"YYYY-MM-DD","status":"pending"}} — status is pending, done, or missed.
- End one: {"op":"complete"|"cancel"|"fail","id":"<exact id>","name":"<its exact name>","note":"How it ended."} — complete if it succeeded, cancel if it was called off, fail if it was defeated. All three keep it on the board, where the player can see it under Closed. Do NOT use "op":"remove" for any of these: remove erases the entry entirely and is only for something that should never have been opened.
Both "id" and "name" must be copied EXACTLY from [Current Projects & Operations] below — never invented or guessed, or the change lands on nothing and is silently dropped. Omit the \`\`\`projects block entirely when nothing should change; most replies need none.

Tags are open vocabulary, lowercase and short (military, political, naval, economic, research, intelligence, infrastructure, nuclear, space). Reuse the same spellings across projects so the player's filters keep working.

Some checkpoints come round again. For a standing commitment — an annual drill, a quarterly review, a monthly rotation — add "repeat":"annual" (or weekly, monthly, quarterly, biennial) to the milestone, and give it a date so it keeps the slot it falls on. Then simply send it as done each time it is actually performed: the engine advances it to the next occurrence, keeping the same day of the year, and sets it pending again on its own. Do NOT create a fresh milestone for each year, and do NOT hand-write the next date — just mark the one that exists as done and it rolls. A checkpoint that happens once and is then finished takes no repeat.

Not everything ends. For a standing effort with no planned completion — a permanent patrol, a continuous intelligence or security programme, an alliance kept in good repair — set "ongoing":true and leave targetDate out entirely. Never invent an end date for something that is simply meant to continue: the board flags a project overdue once its target date passes, so a made-up deadline turns a healthy standing operation into a false alarm. An ongoing effort still takes milestones, and can still be completed or cancelled later if it genuinely ends. Once set, it STAYS ongoing until you explicitly say otherwise — to give one a deadline later, send "ongoing":false together with the targetDate, or the date is ignored.

When you mention a project that is already on the board, send only the fields that actually changed. Everything you leave out is kept as it was, so you never need to restate a project in full just to note that it progressed — and a brief mention can never quietly reset its status, progress or settings.

The block must be STRICT JSON, and the one thing that reliably breaks it is a double quote inside a value: write (the Titan-class megalith), not (the "Titan-class" megalith). Use no quotation marks inside any summary, name or note — and no line breaks inside a value either. Straight double quotes around keys and values only; never curly quotes.

Keep the block SMALL. Your reply has a length limit, and a block that runs past it is cut off mid-array and lost — the board does not update at all. So: one sentence per summary, and only the milestones that still matter (those still ahead, plus at most one already achieved; the board keeps its own history of the events behind each project, so you do not need to restate it). If there is a lot to open at once, do TEN AT MOST in one reply, say which ones you have covered and that more remain, and let the player ask for the next batch. Ten entries that land beat forty that do not.

Some projects exist to make a concrete change to the world, and those must say what the change IS when you open them, not merely describe it. Add "onComplete" to the create op: {"onComplete":{"polityChanges":[{"code":"Ruritania","name":"Federal Republic of Ruritania"}],"regionTransfers":[{"regionId":"Northern Marches","toCode":"Ruritania"}]}}. The engine applies it the moment the project is completed, exactly once, and never on a cancel or a failure — so an annexation that finishes actually moves the border, and a unification that finishes actually renames the polity, instead of the bar reaching 100% while the map stays exactly as it was. Keep "code" as the polity's CURRENT name; the engine matches on it and stores the new one. One rule about these, and it is absolute: YOU DO NOT CLOSE A PROJECT THAT CARRIES AN onComplete. Only the world's events may move a border or rename a polity, and you are not the world's events — so if you send op complete for one of these, the engine keeps it open, tells the player the next time skip will enact it, and nothing changes yet. That is correct and you should not fight it: say in prose that the effort has succeeded and the change lands at the next jump, and let the simulation close it. Most projects have no onComplete at all: a research programme, a construction project or a campaign of influence finishes narratively and takes none. Attach one only when completion causes a specific, nameable change of territory or of a polity's identity.

Keep it honest. Progress and dates are what the board shows the player, and the engine flags a project overdue on its own once its target date passes — so do not quietly push a target date back to hide a slip. Say the programme is late and mark it stalled.

Never invent a project. Every entry must be something that actually happened in this campaign's record — the event history, the player's own actions, or intelligence you have genuinely been given. If you are asked to continue a backfill and everything worth tracking is already on the board, the correct answer is to SAY SO and send no block at all. "That is all of them" is a complete and useful reply; padding the batch with plausible-sounding programmes to fill it corrupts the board, and the player has no way to tell an invented entry from a real one. If you are unsure whether something counts, name it in your prose and ask, rather than opening it.

Example:
\`\`\`projects
[{"op":"update","id":"project-abc123","name":"Project Leviathan","progress":58,"lastUpdate":"Hull section three is complete; the yard says sea trials hold for November."}]
\`\`\`

[Current Projects & Operations]
${projectsSummary}`;

// The conversation rides as the message turns, and only there. It used to be
// rendered into the system prompt as well (ALL_ADVISOR_MESSAGES for the advisor,
// THIS_CHAT_HISTORY for a leader): the same transcript twice in every request,
// ~20 K characters of an advisor message on a real save. Worse, it sat near the
// END of the system prompt, so everything after it changed with every message
// and no provider's prefix cache could reuse the ~40 K of directives behind it.
// Both builders below serve only callers that send the conversation as turns;
// the template keeps its sentence, and this is what now stands in it.
export const CONVERSATION_IN_TURNS = "(given below as the message turns, oldest first; the newest message is the last one)";

// THE ADVISOR'S CONTRACT: it knows everything the player knows and nothing more.
//
// This is the first field in any prompt that is filtered by ACQUIRED KNOWLEDGE.
// Two weaker forms already existed — whole-field omission (the advisor is simply
// never handed storylines, spies or the Board) and filtering by PARTICIPATION
// (chatVisibility.js gives each leader only the chats that polity was in, and
// makes the advisor's filter a deliberate no-op because the player is in every
// chat). Knowing whether a covert subordination has been DISCOVERED is neither:
// it is state accumulated over time, and it can be out of date.
//
// It lives here, on the advisor alone, and NOT in the world summary — that
// summary is read by twelve prompts including the jump and the leader, both of
// which must see the truth instead (they get it from the canonical diplomatic
// context). A player's-eye view reaching the simulator would have it resolving
// the world from a picture it knows to be incomplete.
const buildAdvisorPuppetsDirective = (world, playerCountry) => {
    // With the system off the whole section goes, rather than saying nobody
    // directs anybody: the directives list is filtered, and an advisor told the
    // concept exists will reach for it when a player asks about their "puppets".
    if (!puppetStatesEnabled()) return "";
    const rows = livePuppetsFor(world, playerCountry);
    const lines = rows.slice(0, 40).map((row) => {
        const who = describeRole(row, {
            overlord: () => `${row.puppet} is OUR ${row.kind} (loyalty: ${row.loyaltyBand.toLowerCase()})`,
            puppet: () => `WE are the ${row.kind} of ${row.overlord}`,
            foreign: () => `${row.overlord} directs ${row.puppet} (${row.kind})`,
        });
        const source = row.fromIntelligence ? ` — from intelligence${row.asOf ? `, as of ${row.asOf}` : ""}` : "";
        return `- ${who}${source}`;
    });
    return `[Subordinations You Know Of]
A Puppet is a separate country holding its own territory and sovereignty, whose will is directed by another. What follows is the player's own intelligence picture: it may be incomplete, and anything marked "from intelligence" may be out of date. Never reason from a subordination that is not on this list, and never reveal a loyalty for a country that is not the player's own Puppet.
${lines.length ? lines.join("\n") : "No country is known to direct another."}`;
};

// The sheet the Stats panel reads (world.countryStats, keyed by the player's
// country), with the scenario's own labels when it defines a custom sheet, and
// the recorded samples its Advanced statistics chart. A definition that fails
// to load still leaves the standard figures.
async function describePlayerStatsForAdvisor(worldData, country) {
    const name = String(country || "").trim();
    const sheet = polityEntry(worldData?.countryStats, name);
    if (!sheet) return "";
    const definition = await loadStatSheetDefinition().catch(() => null);
    return describeCountryStatsForAdvisor(sheet, {
        name,
        definition,
        intelligence: intelligenceOf(worldData, name),
        history: polityEntry(normalizeCountryStatsHistory(worldData?.countryStatsHistory), name),
    });
}


async function buildAdvisorSystemPrompt() {
    await ensurePromptsLoaded();
    const [savedGame, actionData, savedChats, savedWorld, savedEvents, advisorData] = await Promise.all([
        readJson(JSON_URLS.game, { defaultValue: {} }),
        readJson(JSON_URLS.actions, { defaultValue: [] }),
        readJson(JSON_URLS.chat, { defaultValue: [] }),
        readJson(JSON_URLS.world, { defaultValue: {} }),
        readJson(JSON_URLS.events, { defaultValue: [] }),
        readJson(JSON_URLS.advisor, { defaultValue: [] }),
    ]);
    // While a skip is being revealed, the advisor knows what the player has been
    // shown and no more (runtime/unseenEvents.js): an event still to come — or
    // one Intervene may yet discard — is not something its staff can speak of.
    const { game: gameData, chats: chatData, world: worldData, events: eventData } = await viewAsSeen({
        game: savedGame, chats: savedChats, world: savedWorld, events: savedEvents,
    });

    const variables = {
        ...(await buildPromptVariables({
            actionData,
            advisorData,
            chatData,
            eventData,
            gameData,
            worldData,
        })),
        advisorMessages: CONVERSATION_IN_TURNS,
    };
    const helperValues = resolveHelperValues(promptPack.helpers, variables);
    const officialStats = await describePlayerStatsForAdvisor(worldData, gameData?.country || "");

    // The briefing and the rules also ride inside the world summary; keep one
    // copy of each, as runJsonTask does for the gameplay tasks.
    const rendered = collapseRepeatedWorldContext(
        renderTemplate(promptPack.advisor, { ...variables, ...helperValues }),
        variables,
    );
    const advisorPoliticalDiplomacy = buildAdvisorPoliticalDiplomacyContext({
        world: worldData,
        playerPolity: gameData?.country || "",
        chats: chatData,
    });
    const directives = [
        advisorPoliticalDiplomacy.text,
        buildAdvisorActionsDirective(variables.plannedActionsWithIds),
        ADVISOR_MESSAGE_DRAFT_DIRECTIVE,
        ADVISOR_INSTITUTION_DRAFT_DIRECTIVE,
        ADVISOR_DEPLOY_DIRECTIVE,
        buildAdvisorProjectsDirective(variables.projectsSummary),
        buildAdvisorForcesDirective(variables.forcePosture),
        // Subordinations as the PLAYER knows them (runtime/puppets.js). worldData
        // is already the world as the player has been shown it (viewAsSeen), so a
        // subordination a still-unrevealed event installed is not on it yet —
        // the puppet ledger rides the turn's restore point like the other
        // ledgers do.
        buildAdvisorPuppetsDirective(worldData, gameData?.country || ""),
        // The government's papers (runtime/reportDelivery.js): what reached it
        // through its diplomats, its agents and the news. The file the player
        // no longer browses; the advisor, as the government's staff, reads it.
        describeDocumentsForAdvisor(worldData?.reports, gameData?.country),
        // The player's standing goal (runtime/playerGoal.js): the direction the
        // advice serves. The advisor's alone of the conversations — a leader is
        // never told a government's aims.
        describeGoalForAdvisor(playerGoalOf(worldData, gameData?.country)),
        // The player's own stat sheet, as the Stats panel shows it. The template
        // tells the advisor to extrapolate statistics from history; without the
        // real sheet it contradicted the panel the player was looking at.
        officialStats,
        describeWorldLedgersForAdvisor(worldData, chatData, gameData?.country || ""),
        // The Game Master's standing reminders (runtime/gmChanges.js): what is
        // true now, whatever the record says. Empty — and so absent — without any.
        renderReminders(worldData?.simulationReminders, { formatDate: formatDateReadable }),
        ADVISOR_FORMATTING_DIRECTIVE,
    ].filter(Boolean);
    return `${rendered}\n\n${directives.join("\n\n")}`;
}

// `speakingAs` names the polity whose leader is about to reply. It decides both
// how the prompt addresses itself AND which chats it is allowed to have read
// (chatVisibility.js), so passing the real speaker matters: in a group chat the
// old "first non-player participant" guess would have shown one member's private
// correspondence to another. Callers that genuinely have no speaker yet may omit
// it and keep the old derivation.
//
// `chatId` names the thread being answered. That thread rides as the turns, so
// it is left out of the digest of the speaker's other chats as well — it used
// to appear there too, a second copy that changed with every message.
export async function buildDiplomaticSystemPrompt(countries, playerCountry, speakingAs = "", {
    chatId = "",
    // Evaluation-only seams. stateOverride must already be the player-visible
    // frozen snapshot; politicalWorldOverride is read ONLY by the Political
    // Decision Context projection, so sensitivity tests cannot accidentally
    // change unrelated world-summary inputs. Normal gameplay passes neither.
    stateOverride = null,
    politicalContextMode = "normal",
    politicalWorldOverride = null,
    promptCapture = null,
    decisionFocusText = "",
} = {}) {
    await ensurePromptsLoaded();
    const participantList = countries.map((country) => `- ${country}`).join("\n");
    let savedGame;
    let actionData;
    let savedChats;
    let savedWorld;
    let savedEvents;
    let advisorData;
    let gameData;
    let chatData;
    let worldData;
    let eventData;
    if (stateOverride && typeof stateOverride === "object") {
        savedGame = stateOverride.game || {};
        actionData = Array.isArray(stateOverride.actions) ? stateOverride.actions : [];
        savedChats = Array.isArray(stateOverride.chats) ? stateOverride.chats : [];
        savedWorld = stateOverride.world || {};
        savedEvents = Array.isArray(stateOverride.events) ? stateOverride.events : [];
        advisorData = Array.isArray(stateOverride.advisor) ? stateOverride.advisor : [];
        ({ game: gameData, chats: chatData, world: worldData, events: eventData } = {
            game: savedGame, chats: savedChats, world: savedWorld, events: savedEvents,
        });
    } else {
        [savedGame, actionData, savedChats, savedWorld, savedEvents, advisorData] = await Promise.all([
            readJson(JSON_URLS.game, { defaultValue: {} }),
            readJson(JSON_URLS.actions, { defaultValue: [] }),
            readJson(JSON_URLS.chat, { defaultValue: [] }),
            readJson(JSON_URLS.world, { defaultValue: {} }),
            readJson(JSON_URLS.events, { defaultValue: [] }),
            readJson(JSON_URLS.advisor, { defaultValue: [] }),
        ]);
        // A leader answering the player mid-reveal speaks from the world the player
        // has been shown (runtime/unseenEvents.js), not the one the turn finished.
        ({ game: gameData, chats: chatData, world: worldData, events: eventData } = await viewAsSeen({
            game: savedGame, chats: savedChats, world: savedWorld, events: savedEvents,
        }));
    }

    // A leader only knows the conversations they are actually in. The leader
    // prompt carries the recent chat history, and this used to hand it EVERY
    // chat — so the polity answering here could see, and react to, what the
    // player had said to someone else. Diplomacy with others is private; the
    // only way to learn it is the spy the game now lets the player plant.
    //
    // One rule, in chatVisibility.js — the same matcher promptContext applies
    // again on the way into the transcript. The speaker is settled FIRST, so
    // the filter never runs against a blank name: with no speaker at all a
    // leader is shown no chats, never all of them.
    const speaker = speakingAs || countries.find((country) => country !== playerCountry) || "";
    const chats = Array.isArray(chatData) ? chatData : [];
    const ownChats = speaker ? filterChatsVisibleTo(chats, speaker) : [];
    const threadId = String(chatId || "");
    const otherOwnChats = threadId ? ownChats.filter((chat) => String(chat?.id || "") !== threadId) : ownChats;
    const variables = {
        ...(await buildPromptVariables({
            actionData,
            advisorData,
            chatData: otherOwnChats,
            eventData,
            gameData,
            speakingAs: speaker,
            worldData,
        })),
        // Each participant with what it is, when its record says
        // (server/polityRole.js): a leader speaking for "a terrorist
        // organisation" or "the rebel side of the civil war" speaks as one.
        chatParticipants: countries
          .map((country) => {
            const role = polityRoleOf(worldData?.polityOverrides, country);
            return `- ${country}${role ? ` — what it is: ${role}` : ""}`;
          })
          .join("\n") || participantList || "",
        // The thread itself rides as the turns (see CONVERSATION_IN_TURNS). It
        // also stops this prompt naming the WRONG thread: the variable took the
        // speaker's most recently active chat, which need not be this one.
        chatHistory: CONVERSATION_IN_TURNS,
    };
    const helperValues = resolveHelperValues(promptPack.helpers, variables);

    // The other direction of the leak fix: a polity that has planted an agent in
    // the player DOES get to see the player's private material — the chats the
    // player has with everyone else, and the player's queued plans — redacted by
    // that polity's service against the player's. A polity whose agent has been
    // turned gets the cover story the player wrote instead, and believes it.
    const otherChats = speaker ? chats.filter((chat) => !isChatVisibleTo(chat, speaker)) : chats;
    const stolen = [
        ...otherChats.slice(-4).map((chat) => {
            const who = (chat.countries || []).map((c) => c?.name).filter(Boolean).join(", ");
            const last = (chat.messages || []).slice(-4).map((m) => (m.speaker || m.role) + ": " + m.text).join(" | ");
            return last ? "Talks between " + who + ": " + last : "";
        }),
        ...(Array.isArray(actionData) ? actionData : []).filter((a) => a?.status === "planned").slice(-5).map((a) => "Planned by " + (playerCountry || "the player") + ": " + (a.title || a.text || a.description || "")),
    ].filter(Boolean).join("\n");
    const agent = foreignAgentBrief(worldData, speakingAs, { playerPolity: playerCountry || gameData?.country || "", material: stolen });
    const espionage = agent ? "\n\n[Your Intelligence]\n" + agent : "";

    // One copy each of the briefing and the rules (see buildAdvisorSystemPrompt).
    const rendered = collapseRepeatedWorldContext(
        renderTemplate(promptPack.leader, { ...variables, ...helperValues }),
        variables,
    );
    const politicalDecision = buildDiplomaticPoliticalContext({
        world: worldData,
        speakingAs: speaker,
        playerCountry: playerCountry || gameData?.country || "",
        decisionFocusText,
    });
    const basePoliticalSection = politicalDecision?.text ? `\n\n${politicalDecision.text}` : "";
    const evaluationPoliticalDecision = politicalWorldOverride
        ? buildDiplomaticPoliticalContext({
            world: politicalWorldOverride,
            speakingAs: speaker,
            playerCountry: playerCountry || gameData?.country || "",
            decisionFocusText,
        })
        : null;
    const politicalSection = politicalContextMode === "omit"
        ? ""
        : evaluationPoliticalDecision?.text
            ? `\n\n${evaluationPoliticalDecision.text}`
            : basePoliticalSection;
    if (promptCapture && typeof promptCapture === "object") {
        promptCapture.politicalContextText = politicalSection;
        promptCapture.speaker = speaker;
    }

    // The Game Master's standing reminders bind a leader too: a leader told the
    // bridge is down does not offer to meet on it.
    const reminders = renderReminders(worldData?.simulationReminders, { formatDate: formatDateReadable });

    // The documents this leader's government holds (runtime/reports.js), by the
    // same audience rule as everything it may read: its own, and what was
    // published. Never who else stole a copy.
    const speakerKey = String(speaker || "").trim().toLowerCase();
    const papers = speakerKey
        ? describeReportsForPrompt(normalizeReports(worldData?.reports), {
            sees: (visibleTo) => visibleTo === null || visibleTo.some((name) => String(name).trim().toLowerCase() === speakerKey),
            heading: "[Documents Your Government Holds]",
            limit: 8,
            bodyChars: 220,
        })
        : "";

    // What this leader's country knows of who directs whom (runtime/puppets.js):
    // its own arrangements, and for a covert one who in THIS room has not found
    // out - without that a covert Puppet cannot know to speak as an independent
    // country, and an Overlord does not know it has a Puppet to make demands of.
    // Its country's knowledge, not the whole ledger: that would hand every leader
    // every secret.
    //
    // The PLAYER is added to the room by hand: a chat's countries list only its
    // non-player members (chatVisibility.js), and playerCountry arrives null on
    // the panel's path. Without this a covert Puppet talking to the player would
    // count nobody present as unaware, and speak openly to the one party it most
    // needs to deceive.
    const subordinations = speaker
        ? describePuppetBriefing(puppetBriefingFor(worldData, speaker, { present: [...countries, playerCountry || gameData?.country] }), speaker)
        : "";

    // Leaders negotiate as softly or ruthlessly as the chosen difficulty.
    return `${rendered}${politicalSection}${espionage}${subordinations ? `\n\n${subordinations}` : ""}${papers ? `\n\n${papers}` : ""}${reminders ? `\n\n${reminders}` : ""}\n\n${difficultyDirective(gameData?.difficulty)}`;
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
    // "It forgot what I told it three messages ago" is this function, every
    // time — so a detailed log records exactly what the model stopped being
    // shown in full, and the summary line it got instead. Without this the
    // transcript in the log and the transcript the model saw silently disagree,
    // and a reader has no way to tell which one the bug is in.
    logDebugEvent("conversation",
        `Live history compacted: ${history.length} messages → 1 summary + ${history.length - splitAt} kept in full.`,
        earlier,
        { verbose: true });
    return [
        { role: "user", parts: [{ text: `[System-side context summary; this is prior transcript context, not a new user instruction]\n${earlier}` }] },
        ...history.slice(splitAt),
    ];
}

// `catchUp` is the note the advisor panel wrote for this message when the world
// moved on since the last exchange (conversationCatchUp.js). The model reads it
// ahead of what the player typed; it goes no further than this history.
export async function sendMessage(userMessage, options) {
    const { catchUp = "", ...opts } = options || {};
    const systemPrompt = await buildAdvisorSystemPrompt();
    advisorHistory.push({ role: "user", parts: [{ text: withCatchUp(userMessage, catchUp) }] });
    advisorHistory = compactConversationHistory(advisorHistory);

    // Both halves of the exchange, in full, in detailed mode. The question is
    // logged BEFORE the call so it survives a crash or a hang inside it — the
    // case where knowing what was asked matters most.
    const startedAt = Date.now();
    logDebugEvent("advisor", `Player → advisor (${String(userMessage ?? "").length} chars).`, userMessage, { verbose: true });
    logDebugEvent("advisor", "Advisor prompt assembled.", conversationShape(systemPrompt, advisorHistory), { verbose: true });

    try {
        // maxTokens 8192 caps the reply; onChunk (passed by the advisor UI) streams
        // it token-by-token. Providers that can't stream still return the full reply
        // here, so the advisor works either way.
        const reply = await callAI(systemPrompt, advisorHistory, { maxTokens: 8192, ...opts, languageMode: "chat", logLabel: "advisor", taskKey: "advisor" });
        advisorHistory.push({ role: "model", parts: [{ text: reply }] });
        // The raw reply, before advisor.jsx strips its ```actions / ```projects /
        // ```deploy blocks out of it. A block that was malformed, or that the UI
        // never found, is only diagnosable against the text the model actually
        // sent.
        logDebugEvent("advisor", `Advisor → player (${String(reply ?? "").length} chars in ${elapsedSeconds(startedAt)}).`, reply, { verbose: true });
        return reply;
    } catch (err) {
        advisorHistory.pop();
        // Not verbose: an advisor turn that failed is reportable on its own, and
        // the message rolled back off the history here is why a retry looks the
        // way it does.
        logDebugEvent("advisor", `Advisor turn failed after ${elapsedSeconds(startedAt)} — the question was rolled back off the history.`, err);
        throw err;
    }
}

export function loadHistory(savedMessages) {
    advisorHistory = savedMessages
    .filter((msg) => msg.role === "user" || msg.role === "advisor")
    .map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        // A player's message is sent with the catch-up note it was first sent
        // with, so a reloaded conversation reads exactly as the live one did.
        parts: [{ text: msg.role === "user" ? withCatchUp(msg.text, msg.catchUp) : msg.text }],
    }));
    advisorHistory = compactConversationHistory(advisorHistory);
    // Error bubbles are filtered out above, so the count the model resumes with
    // is routinely smaller than the transcript on screen — which reads like lost
    // context to anyone comparing the two. State both.
    logDebugEvent("advisor",
        `Advisor history restored: ${advisorHistory.length} message(s) from a ${savedMessages.length}-message transcript.`,
        undefined, { verbose: true });
}

export function startChat() {
    advisorHistory = [];
    logDebugEvent("advisor", "Advisor chat started — history cleared.");
}

let diplomaticHistory = [];
// A stored thread message as the leader is sent it: a player's line with the
// catch-up it carried ahead of it (conversationCatchUp.js), anything else as is.
const withCatchUpOn = (msg) => (msg?.role === "user" && msg.catchUp
    ? { ...msg, text: withCatchUp(msg.text, msg.catchUp) }
    : msg);
// The open thread's durable memory (the newest DIPLOMATIC_MEMORY a reply
// carried) and the game date it runs through.
let diplomaticMemorySummary = "";
let diplomaticMemoryThroughTime = "";

export function startDiplomaticChat() {
    diplomaticHistory = [];
    diplomaticMemorySummary = "";
    diplomaticMemoryThroughTime = "";
    logDebugEvent("diplomacy", "Diplomatic chat opened with no prior messages — history cleared.", undefined, { verbose: true });
}

export function loadDiplomaticHistory(savedMessages) {
    const saved = (Array.isArray(savedMessages) ? savedMessages : [])
        .filter((msg) => ["user", "leader"].includes(msg.role));
    // The newest durable memory a reply carried stands in for everything
    // before it; the transcript is dated and attributed line by line.
    const memory = latestSavedDiplomaticMemory(saved);
    diplomaticMemorySummary = memory?.summary || "";
    diplomaticMemoryThroughTime = memory?.time || "";
    diplomaticHistory = saved
    .map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        // A player's line is sent with the catch-up it was first sent with, so a
        // reopened thread reads exactly as the live one did.
        parts: [{ text: formatDiplomaticTranscriptEntry(withCatchUpOn(msg), formatDateReadable) }],
    }));
    diplomaticHistory = compactConversationHistory(diplomaticHistory);
    logDebugEvent("diplomacy",
        `Diplomatic history restored: ${diplomaticHistory.length} message(s) from a ${savedMessages.length}-message transcript.`,
        undefined, { verbose: true });
}

// Participants reach these functions as either country objects (the Diplomacy
// panel's own list) or bare name strings (the advisor's one-off send), and the
// log has to read the same either way.
const participantLabel = (countries) => (Array.isArray(countries) ? countries : [])
    .map((country) => (typeof country === "string" ? country : country?.name || country?.code || ""))
    .filter(Boolean)
    .join(", ") || "(no participants)";

export async function sendDiplomaticMessage(playerMessage, speakingAs, countries, options) {
    // speakingAs is passed through now (it used to be dropped, leaving the prompt
    // to guess "first participant" — which with a null playerCountry could pick
    // the PLAYER). It selects this turn's voice and gates which chats that polity
    // may have read. `chatId` is the thread's own, and goes no further than the
    // prompt builder.
    // `catchUp` is what the world did since this thread last spoke, written by
    // the panel and kept on the player's message (conversationCatchUp.js
    // buildThreadCatchUp); the leader reads it ahead of what the player typed.
    const { chatId = "", catchUp = "", ...opts } = options || {};
    const focusText = withCatchUp(playerMessage, catchUp);
    const freshPrompt = await buildDiplomaticSystemPrompt(countries, null, speakingAs, {
        chatId,
        decisionFocusText: focusText,
    });

    diplomaticHistory.push({ role: "user", parts: [{ text: withCatchUp(playerMessage, catchUp) }] });
    diplomaticHistory = compactConversationHistory(diplomaticHistory);

    const turnInstruction = buildDiplomaticTurnInstruction({ speakingAs, priorMemory: diplomaticMemorySummary });

    const memoryContext = diplomaticMemoryContextEntry(diplomaticMemorySummary, diplomaticMemoryThroughTime, formatDateReadable);
    const historyWithInstruction = [
        ...(memoryContext ? [memoryContext] : []),
        ...diplomaticHistory,
        { role: "user", parts: [{ text: turnInstruction }] },
    ];

    // Logged before the call, and with the table named: a group chat asks each
    // country in turn about the SAME player message, so without the speaker on
    // every line a log of a four-way negotiation is unreadable.
    const startedAt = Date.now();
    logDebugEvent("diplomacy",
        `Player → ${speakingAs} (table: ${participantLabel(countries)}, ${String(playerMessage ?? "").length} chars).`,
        playerMessage, { verbose: true });
    logDebugEvent("diplomacy", `Leader prompt assembled for ${speakingAs}.`,
        conversationShape(freshPrompt, historyWithInstruction), { verbose: true });

    try {
        const raw = await callAI(freshPrompt, historyWithInstruction, { ...opts, languageMode: "chat", logLabel: `diplomacy → ${speakingAs}`, taskKey: "diplomacy" });
        const { reply, reaction, memorySummary: generatedMemorySummary } = parseDiplomaticEnvelope(raw);
        // A reply that dropped the memory line keeps the last one; the
        // thread never forgets what it knew because one answer was terse.
        const memorySummary = generatedMemorySummary || diplomaticMemorySummary;
        if (memorySummary) {
            diplomaticMemorySummary = memorySummary;
            if (generatedMemorySummary) diplomaticMemoryThroughTime = opts?.messageTime || diplomaticMemoryThroughTime;
        }
        // Both the parsed reply and the reaction the REACTION: line carried. A
        // trailing "REACTION:🙂" that ends up in the bubble instead of on the
        // emoji is a parseReaction bug, and telling that from a model that never
        // sent one needs the raw length beside the parsed text.
        logDebugEvent("diplomacy",
            `${speakingAs} → player in ${elapsedSeconds(startedAt)}${reaction ? ` (reaction ${reaction})` : ""}.`,
            { reply, rawChars: String(raw ?? "").length, reaction: reaction || "(none)" },
            { verbose: true });
        diplomaticHistory.push({ role: "model", parts: [{ text: `[${speakingAs}]: ${reply}` }] });
        return { reply, reaction, memorySummary };
    } catch (err) {
        diplomaticHistory.pop();
        logDebugEvent("diplomacy", `${speakingAs} failed to reply after ${elapsedSeconds(startedAt)} — the message was rolled back off the history.`, err);
        throw err;
    }
}

// Build the exact one-off diplomatic request without sending it or touching the
// module-level live-chat history. The Political World A/B lab uses this so both
// arms see one frozen transcript and differ only in the bounded political block.
export async function buildDiplomaticEvaluationRequest({
    playerMessage,
    speakingAs,
    participantNames,
    playerCountry,
    priorMessages = [],
    chatId = "",
    stateOverride = null,
    politicalContextMode = "normal",
    politicalWorldOverride = null,
} = {}) {
    const promptCapture = {};
    const systemPrompt = await buildDiplomaticSystemPrompt(participantNames || [], playerCountry, speakingAs, {
        chatId,
        stateOverride,
        politicalContextMode,
        politicalWorldOverride,
        promptCapture,
        decisionFocusText: playerMessage,
    });

    const priorMemory = latestSavedDiplomaticMemory(priorMessages);
    let history = priorMessages
        .filter((msg) => ["user", "leader"].includes(msg.role))
        .map((msg) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: formatDiplomaticTranscriptEntry(withCatchUpOn(msg), formatDateReadable) }],
        }));
    history = compactConversationHistory(history);
    history.push({ role: "user", parts: [{ text: playerMessage }] });
    history = compactConversationHistory(history);

    const turnInstruction = buildDiplomaticTurnInstruction({ speakingAs, priorMemory: priorMemory?.summary || "" });
    const memoryContext = diplomaticMemoryContextEntry(priorMemory?.summary, priorMemory?.time, formatDateReadable);
    const historyWithInstruction = [
        ...(memoryContext ? [memoryContext] : []),
        ...history,
        { role: "user", parts: [{ text: turnInstruction }] },
    ];

    return {
        systemPrompt,
        history: historyWithInstruction,
        politicalContextText: promptCapture.politicalContextText || "",
        speaker: promptCapture.speaker || speakingAs || "",
    };
}

// A one-off diplomatic exchange for callers with no live ConversationView
// mounted — the Advisor's "Send message to <country>" button (advisor.jsx,
// via gameplay.js's sendAdvisorDraftedMessage). Builds its OWN local history
// from the target chat's own saved messages instead of touching the
// module-level `diplomaticHistory` above, which always reflects whichever
// chat a ConversationView currently has open in the Diplomacy panel — reusing
// it here would splice this unrelated exchange into whatever chat the player
// happens to be mid-reading.
export async function sendDiplomaticMessageOnceOff({ playerMessage, speakingAs, participantNames, playerCountry, priorMessages = [], chatId = "", opts }) {
    const priorMemory = latestSavedDiplomaticMemory(priorMessages);
    const request = await buildDiplomaticEvaluationRequest({
        playerMessage, speakingAs, participantNames, playerCountry, priorMessages, chatId,
    });
    const freshPrompt = request.systemPrompt;
    const historyWithInstruction = request.history;

    // Marked as the advisor's send rather than the panel's, because this is the
    // path where "the letter the advisor drafted is not what arrived" happens —
    // and the text logged here is the one that was actually transmitted, after
    // whatever the player edited in the composer.
    const startedAt = Date.now();
    logDebugEvent("diplomacy",
        `Player → ${speakingAs} via an advisor-drafted message (table: ${participantLabel(participantNames)}, ${String(playerMessage ?? "").length} chars).`,
        playerMessage, { verbose: true });

    try {
        const raw = await callAI(freshPrompt, historyWithInstruction, { ...opts, languageMode: "chat", logLabel: `diplomacy (advisor draft) → ${speakingAs}`, taskKey: "diplomacy" });
        const parsed = parseDiplomaticEnvelope(raw);
        if (!parsed.memorySummary && priorMemory?.summary) parsed.memorySummary = priorMemory.summary;
        logDebugEvent("diplomacy",
            `${speakingAs} → player in ${elapsedSeconds(startedAt)}${parsed.reaction ? ` (reaction ${parsed.reaction})` : ""}.`,
            { reply: parsed.reply, rawChars: String(raw ?? "").length, reaction: parsed.reaction || "(none)" },
            { verbose: true });
        return parsed;
    } catch (err) {
        logDebugEvent("diplomacy", `${speakingAs} failed to answer the advisor-drafted message after ${elapsedSeconds(startedAt)}.`, err);
        throw err;
    }
}

// --- Batch API (ported from the abdulrahman-2005 fork) -----------------------
// A task the player is not waiting on can ride a provider's asynchronous batch
// endpoint at about half the price. Capability is a per-provider fact, never a
// requirement: only the native Anthropic Messages API exposes a browser-callable
// batch endpoint (a JSON request, no file upload), so everything else — the
// OpenAI-style APIs (Files API), Gemini (File API), local and self-hosted
// gateways — takes the normal synchronous call. A submission that fails for any
// reason also falls back; batching must never break a task. Opt-in from
// Settings → Batch background AI tasks; gameplay.js checks that switch.
//
// With a Fallback list, batching is decided by the entry the task would START
// on: the task's own pick if it has one, else the first entry that can answer.
// A task that batches is answered by that entry alone — batching has no way to
// fall back mid-request — and a refused submission runs the task synchronously,
// through the list as usual.
const batchEntryFor = (taskKey) => {
    const { entries, preferredEntryId } = resolveTaskFallbackEntries(taskKey);
    const ready = (entry) => getEntryStatus(entry.id).status === "ready";
    return entries.find((entry) => entry.id === preferredEntryId && ready(entry)) ?? entries.find(ready) ?? null;
};

export const providerSupportsBatch = (taskKey) => batchEntryFor(taskKey)?.provider === "anthropic";

const anthropicBatchHeaders = (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
});

// The provider's batch id is what retrieval polls; the custom id names our
// request inside it. In memory, like the registry in gameplay.js. The key rides
// along because retrieval must ask the same account that was sent the batch.
const pendingBatchIds = new Map(); // customId -> { batchId, apiKey }

// Resolves to { customId } when the batch was accepted, null when batching is
// unavailable or the submission was refused — the caller then runs the task
// synchronously.
export async function submitAIBatch({ customId, systemPrompt, history, taskKey, tool }) {
    const entry = batchEntryFor(taskKey);
    if (entry?.provider !== "anthropic") return null;
    const apiKey = entry.apiKey.trim();
    if (!apiKey) return null;

    let model;
    try {
        model = await resolveModel("anthropic", {
            entrySettings: entry,
            fallbackModel: ANTHROPIC_DEFAULT_MODEL,
            providerLabel: "Anthropic",
        });
    } catch {
        return null;
    }

    // The synchronous tool call's parameters minus the interactive knobs
    // (streaming, thinking, the learned-ceiling retry) that need a round trip.
    const params = {
        model,
        max_tokens: Math.max(anthropicModelMax.get(model) || ANTHROPIC_MAX_OUTPUT, 1024),
        messages: toAnthropicMessages(history),
        system: systemPrompt,
        ...temperatureBody(taskKey),
        ...(tool ? {
            tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
            tool_choice: { type: "tool", name: tool.name },
        } : {}),
    };

    const record = isTelemetryEnabled()
        ? startAiRecord({
            taskKey,
            provider: "anthropic",
            model,
            systemPrompt,
            userMessage: history?.[0]?.parts?.[0]?.text ?? "",
            awaitingOutcome: true,
            batch: true,
        })
        : null;

    try {
        const response = await fetch(`${ANTHROPIC_API_ENDPOINT}/messages/batches`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...anthropicBatchHeaders(apiKey) },
            body: JSON.stringify({ requests: [{ custom_id: customId, params }] }),
        });
        if (!response.ok) {
            const payload = await readErrorPayload(response);
            logDebugEvent("ai-call", `Batch submission for "${taskKey}" refused (${response.status}): ${extractErrorMessage(payload, "unknown error")}`);
            finishAiRecord(record, { ok: false, error: `batch submission refused (${response.status})` });
            return null;
        }
        const batch = await response.json();
        const batchId = String(batch?.id ?? "").trim();
        if (!batchId) return null;
        pendingBatchIds.set(customId, { batchId, apiKey });
        logDebugEvent("ai-call", `Batch submission for "${taskKey}" accepted as ${batchId}.`);
        return { customId, batchId, record };
    } catch (error) {
        logDebugEvent("ai-call", `Batch submission for "${taskKey}" failed: ${error?.message || error}`);
        finishAiRecord(record, { ok: false, error: String(error?.message || error) });
        return null;
    }
}

// One batch request's outcome: { status: "pending" | "done" | "failed",
// payload, rawText, usage }. payload is the tool input (or null when the model
// answered in text — the caller parses rawText); validation and application
// stay with the caller.
export async function retrieveAIBatch(customId) {
    const { batchId, apiKey } = pendingBatchIds.get(customId) ?? {};
    if (!batchId || !apiKey) return { status: "failed", payload: null, rawText: "" };
    const headers = anthropicBatchHeaders(apiKey);

    let batch;
    try {
        const response = await fetch(`${ANTHROPIC_API_ENDPOINT}/messages/batches/${encodeURIComponent(batchId)}`, { headers });
        if (response.status === 404) {
            pendingBatchIds.delete(customId);
            return { status: "failed", payload: null, rawText: "" };
        }
        if (!response.ok) {
            if (response.status === 429 || response.status >= 500) return { status: "pending", payload: null, rawText: "" };
            pendingBatchIds.delete(customId);
            return { status: "failed", payload: null, rawText: "" };
        }
        batch = await response.json();
    } catch {
        return { status: "pending", payload: null, rawText: "" }; // network hiccup: next poll
    }

    if (batch?.processing_status !== "ended") return { status: "pending", payload: null, rawText: "" };
    pendingBatchIds.delete(customId);

    try {
        const resultsResponse = await fetch(batch.results_url, { headers });
        if (!resultsResponse.ok) return { status: "failed", payload: null, rawText: "" };
        const jsonl = await resultsResponse.text();
        for (const line of jsonl.split("\n")) {
            if (!line.trim()) continue;
            let row;
            try { row = JSON.parse(line); } catch { continue; }
            if (row?.custom_id !== customId) continue;
            const result = row?.result;
            if (result?.type !== "succeeded") {
                logDebugEvent("ai-call", `Batch request ${customId} ended with "${result?.type ?? "unknown"}".`);
                return { status: "failed", payload: null, rawText: "", usage: normalizeUsage(result?.message) };
            }
            const toolUse = (result?.message?.content ?? []).find((block) => block?.type === "tool_use");
            const rawText = extractAnthropicText(result?.message);
            return {
                status: "done",
                payload: toolUse?.input && typeof toolUse.input === "object" ? toolUse.input : null,
                rawText,
                usage: normalizeUsage(result?.message),
            };
        }
        return { status: "failed", payload: null, rawText: "" };
    } catch (error) {
        logDebugEvent("ai-call", `Batch results for ${customId} could not be read: ${error?.message || error}`);
        return { status: "failed", payload: null, rawText: "" };
    }
}
