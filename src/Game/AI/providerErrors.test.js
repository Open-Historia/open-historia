// Runs in a BARE CHECKOUT: providerErrors.js is import-free on purpose.
import test from "node:test";
import assert from "node:assert/strict";

import {
  asUnreachable,
  busyProviderMessage,
  classifyProviderFailure,
  CONNECTION_CLOSED_MESSAGE,
  connectionClosedError,
  OUTPUT_LIMIT_MESSAGE,
  RELAY_CUT_OFF_MESSAGE,
  errorPayloadText,
  extractErrorMessage,
  isBrokenConnectionError,
  isBusyErrorPayload,
  isUnreachableError,
  isUnreachableFailure,
  judgeUnmarkedEnd,
  UNMARKED_END,
  UNREACHABLE_FAILURE,
  unreachableServerError,
  isQuotaExhaustedPayload,
  isStreamingRefusal,
  TOOL_CALL_INSISTENCE,
  isStreamingRequired,
  looksLikeDeliberation,
  providerErrorReplyMessage,
  retryDelayMsFromPayload,
  shouldRetryProviderFailure,
  toolStreamRefusalError,
  describeHtmlErrorPage,
} from "./providerErrors.js";
import {
    contextWindowMessage,
    isContextWindowErrorPayload,
    isContextWindowErrorText,
} from "./providerErrors.js";

// Both pages are from the same field report's log, abridged. The first is a
// gateway's own Next.js 404 (the base URL pointed at the website, not the API);
// it went into the log verbatim, about 10 KB, on every failed call.
const GATEWAY_404_PAGE = '<!DOCTYPE html><html lang="en" class="dark"><head><meta charSet="utf-8"/>'
  + '<title>ModelRouter | Unified AI API and Model Catalog</title>'
  + '<script type="application/ld+json">{"@context":"https://schema.org"}</script></head>'
  + '<body><div class="min-h-screen"><a href="/"><span>ModelRouter</span></a><div class="text-center">'
  + '<h1>404</h1><p>This page doesn&#x27;t exist.</p><a href="/models">Browse Models</a></div></div>'
  + '<script>self.__next_f.push([1,"lots of framework state"])</script></body></html>';

// The second: the endpoint typed without https://, so the request went to the
// game's own server, which answered with Express's default error page.
const MISSING_SCHEME_PAGE = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n'
  + '<body>\n<pre>Cannot POST /inference.dahl.global/v1/chat/completions</pre>\n</body>\n</html>\n';

test("a gateway's 404 page is summarised to what it says, with the fix, not pasted whole", () => {
  const message = describeHtmlErrorPage(GATEWAY_404_PAGE, "OpenAI Compatible request failed (404)");
  assert.match(message, /^OpenAI Compatible request failed \(404\): the endpoint answered with a web page/);
  assert.match(message, /"ModelRouter 404 This page doesn't exist\. Browse Models"/);
  assert.match(message, /Check the endpoint address in Settings/);
  assert.doesNotMatch(message, /<|schema\.org|__next_f|Unified AI API/, "no markup, scripts or head in the message");
  assert.ok(message.length < 400, `summary is ${message.length} chars`);
});

test("the page the game's own server sends back shows the bad address it was given", () => {
  const message = describeHtmlErrorPage(MISSING_SCHEME_PAGE, "OpenAI Compatible request failed (404)");
  assert.match(message, /"Cannot POST \/inference\.dahl\.global\/v1\/chat\/completions"/);
});

test("anything that is not an HTML page is left to the caller", () => {
  assert.equal(describeHtmlErrorPage('{"error":{"message":"nope"}}', "x"), "");
  assert.equal(describeHtmlErrorPage("Rate limit exceeded (10 RPM on free plan).", "x"), "");
  assert.equal(describeHtmlErrorPage("", "x"), "");
  assert.equal(describeHtmlErrorPage("error code: 502", "x"), "");
});

// A DeepSeek V4 Flash field report: a tool call refused mid-stream, retried once,
// refused again — and the task was handed an empty "answer" that it then blamed
// on the model. What the providers throw instead must say it was the provider,
// and carry the flag the task runner reads to re-ask rather than fall back.
test("a tool call the provider refused twice becomes a flagged busy error, not an empty answer", () => {
  const error = toolStreamRefusalError(
    "OpenAI Compatible",
    { message: "An internal error occurred. Please try again later." },
    true,
  );
  assert.equal(error.providerRefusal.busy, true);
  assert.equal(error.providerRefusal.detail, "An internal error occurred. Please try again later.");
  assert.equal(error.message, busyProviderMessage("OpenAI Compatible", "An internal error occurred. Please try again later.", true));
  assert.match(error.message, /overloaded/);
  // Busy after its one retry: the Fallback list moves on.
  assert.equal(error.providerFailure.kind, "busy");
});

test("a refusal that is not about load is quoted as the provider's error, still flagged", () => {
  const error = toolStreamRefusalError("Gemini", { message: "Invalid argument in request." }, false);
  assert.equal(error.providerRefusal.busy, false);
  assert.equal(error.message, providerErrorReplyMessage("Gemini", "Invalid argument in request."));
});

// The frame that started this: an OpenAI-compatible gateway answering HTTP 200
// and then refusing inside the stream. The advisor used to report it as "no
// answer — your model may be out of context".
test("the overloaded frame from a busy gateway is recognised", () => {
  const error = { message: "Service temporarily overloaded", type: "service_unavailable", code: 503 };
  assert.equal(isBusyErrorPayload(error), true);
  assert.equal(errorPayloadText(error), "Service temporarily overloaded");
});

test("each provider's spelling of 'busy' is recognised", () => {
  // Anthropic
  assert.equal(isBusyErrorPayload({ type: "overloaded_error", message: "Overloaded" }), true);
  // Gemini
  assert.equal(isBusyErrorPayload({ code: 503, status: "UNAVAILABLE", message: "The model is overloaded." }), true);
  // OpenAI-shaped rate limiting
  assert.equal(isBusyErrorPayload({ type: "rate_limit_error", message: "Rate limit reached" }), true);
  assert.equal(isBusyErrorPayload({ code: 429 }), true);
  // A bare string, which some gateways send
  assert.equal(isBusyErrorPayload("Server is busy, try again later"), true);
});

// A wrong guess costs one needless request; a missed one costs the turn. But it
// must not swallow the errors that are genuinely the player's to fix.
test("a real configuration error is not mistaken for load", () => {
  assert.equal(isBusyErrorPayload({ message: "Invalid API key provided", code: "invalid_api_key" }), false);
  assert.equal(isBusyErrorPayload({ message: "model 'gpt-9' does not exist", code: 404 }), false);
  assert.equal(isBusyErrorPayload({ message: "context length exceeded", code: "context_length_exceeded" }), false);
  assert.equal(isBusyErrorPayload(null), false);
  assert.equal(isBusyErrorPayload(undefined), false);
});

// The field report: Gemini answered a per-minute free-tier trip with the same
// fatal "quota appears to be exhausted" as a spent balance, so one 429 cost the
// player a whole timeline jump. A per-minute limit must be retryable.
test("a per-minute rate limit is retryable, not a spent quota", () => {
  // What the free tier actually sends: the decisive evidence is the quota id,
  // not the message, and the message carries billing boilerplate regardless.
  const perMinute = {
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "You exceeded your current quota, please check your plan and billing details.",
      details: [{
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }],
      }],
    },
  };
  assert.equal(isQuotaExhaustedPayload(perMinute), false);

  assert.equal(isQuotaExhaustedPayload({ error: { code: 429, message: "Too many requests" } }), false);
  assert.equal(isQuotaExhaustedPayload({ message: "Rate limit reached for requests per minute" }), false);
  // The older, vaguer body. Nothing says the allowance is gone for the day, so
  // it retries — a wasted request is cheaper than a lost turn.
  assert.equal(isQuotaExhaustedPayload({
    error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota)." },
  }), false);
});

test("a spent daily allowance or balance is fatal, because waiting cannot fix it", () => {
  assert.equal(isQuotaExhaustedPayload({
    error: {
      code: 429,
      details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
    },
  }), true);
  assert.equal(isQuotaExhaustedPayload({ error: { message: "You have exceeded your daily quota." } }), true);
  assert.equal(isQuotaExhaustedPayload({ error: { message: "Your credit balance is too low." } }), true);
  assert.equal(isQuotaExhaustedPayload({ code: "insufficient_quota", message: "Please check your billing." }), true);

  assert.equal(isQuotaExhaustedPayload(null), false);
  assert.equal(isQuotaExhaustedPayload({}), false);
});

test("the provider's own RetryInfo beats a fixed guess", () => {
  assert.equal(retryDelayMsFromPayload({
    error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "35s" }] },
  }), 35000);
  assert.equal(retryDelayMsFromPayload({ error: { details: [{ retryDelay: "1.5s" }] } }), 1500);
  // No RetryInfo: the caller keeps its own default rather than inventing one.
  assert.equal(retryDelayMsFromPayload({ error: { code: 429 } }), null);
  assert.equal(retryDelayMsFromPayload(null), null);
  // A provider asking for an hour is saying give up, not hold the turn open.
  assert.equal(retryDelayMsFromPayload({ error: { details: [{ retryDelay: "3600s" }] } }), 120000);
});

test("the payload text survives every shape a gateway sends", () => {
  assert.equal(errorPayloadText({ message: "Overloaded" }), "Overloaded");
  assert.equal(errorPayloadText({ detail: "upstream busy" }), "upstream busy");
  assert.equal(errorPayloadText({ type: "overloaded_error" }), "overloaded_error");
  assert.equal(errorPayloadText({ code: 503 }), "503");
  assert.equal(errorPayloadText("  spaced  "), "spaced");
  assert.equal(errorPayloadText(null), "");
});

test("the busy message blames the provider, and says whether it was retried", () => {
  const first = busyProviderMessage("OpenAI Compatible", "Service temporarily overloaded", false);
  assert.ok(first.includes("OpenAI Compatible is overloaded right now"));
  assert.ok(first.includes("Service temporarily overloaded"));
  assert.ok(!first.includes("retried"));

  const second = busyProviderMessage("OpenAI Compatible", "Service temporarily overloaded", true);
  assert.ok(second.includes("still busy when the request was retried five seconds later"));
});

test("a non-busy error is quoted rather than diagnosed", () => {
  assert.equal(
    providerErrorReplyMessage("Gemini", "Invalid API key provided"),
    "Gemini returned an error instead of a reply: Invalid API key provided.",
  );
  assert.equal(providerErrorReplyMessage("Gemini", ""), "Gemini returned an error instead of a reply.");
});

// Tool calls stream so a long timeline jump keeps the connection warm. A gateway
// that refuses that must cost us the keep-alive only — never tool mode, which is
// the difference between a real turn and canned events.
test("a gateway refusing to stream is recognised, in the shapes they say it", () => {
  for (const message of [
    "streaming is not supported for this model",
    "Streaming is not supported with tools.",
    "Unsupported value: 'stream' does not support true with this model",
    "Invalid parameter: stream",
    "'stream' is not allowed when using function calling",
    "This deployment cannot stream responses",
  ]) {
    assert.equal(isStreamingRefusal(message), true, message);
  }
});

test("an unrelated rejection is left to the structured-output ladder", () => {
  for (const message of [
    "This model does not support tools.",
    "max_tokens: 64000 > 8192, which is the maximum for this model",
    "Invalid API key provided",
    "",
  ]) {
    assert.equal(isStreamingRefusal(message), false, message);
  }
});

// The opposite complaint, and why Anthropic tool calls stream at all: the
// Messages API refuses a long non-streaming request outright, before generating.
test("a provider demanding streaming is recognised and kept apart from a refusal", () => {
  for (const message of [
    "Streaming is strongly recommended for operations that may take longer than 10 minutes.",
    "Streaming is required for this request.",
    "Expected stream=true for a request of this size",
  ]) {
    assert.equal(isStreamingRequired(message), true, message);
    assert.equal(isStreamingRefusal(message), false, message);
  }
});

test("a payload object is read the same way as a bare string", () => {
  assert.equal(isStreamingRefusal({ message: "streaming is not supported" }), true);
  assert.equal(isStreamingRequired({ message: "Streaming is required for this request." }), true);
  assert.equal(isStreamingRefusal(null), false);
  assert.equal(isStreamingRequired(null), false);
});

// ---------------------------------------------------------------------------
// Deliberation instead of a tool call
//
// The verbatim opening of a real failure: an NVIDIA model on openai-compatible,
// which fell back on 3 of 4 turns against a round-356 save because it planned
// until its budget ran out and never emitted the call.
const NVIDIA_MONOLOGUE =
  "We need to produce JSON with events between 2032-11-15 and 2033-02-13 (about 3 months). "
  + "10-13 events. Must include impacts, projectOps updates for projects needing decision. "
  + "Also need to consider diplomatic chats, unitOps, regionTransfers, etc. The player has no "
  + "actions this round. We must simulate world events: ongoing projects progress, diplomatic "
  + "interactions, military movements.\n\nWe must produce events with dates spread across period. "
  + "Probably 11 events.";

test("a planning monologue is recognised as deliberation", () => {
  assert.equal(looksLikeDeliberation(NVIDIA_MONOLOGUE), true);
  assert.equal(looksLikeDeliberation("Let me think about what events to produce first."), true);
  assert.equal(looksLikeDeliberation("Okay, I should start by listing the stalled projects."), true);
  assert.equal(looksLikeDeliberation("First, we need to decide how many events this span warrants."), true);
});

// The tolerant-parsing path (jsonSalvage.js) owns anything that might carry a
// payload. Retrying would throw away an answer it could have salvaged.
test("anything that might still parse is left to the salvage path", () => {
  assert.equal(looksLikeDeliberation('We need to produce this: {"summary":"x","events":[]}'), false);
  assert.equal(looksLikeDeliberation('```json\n{"summary":"x"}\n```'), false);
  assert.equal(looksLikeDeliberation('[{"date":"2032-01-01"}]'), false);
  // A truncated object is still the salvage path's problem, not a retry.
  assert.equal(looksLikeDeliberation('We must produce {"summary":"x","events":[{"date"'), false);
});

test("an ordinary answer is not mistaken for deliberation", () => {
  assert.equal(looksLikeDeliberation(""), false);
  assert.equal(looksLikeDeliberation(null), false);
  assert.equal(looksLikeDeliberation(undefined), false);
  assert.equal(looksLikeDeliberation("   "), false);
  // Narrative prose that happens to contain the words, not at a sentence start
  // in the planning register.
  assert.equal(
    looksLikeDeliberation("The delegation will need to cross the border before winter closes the passes."),
    false,
  );
  assert.equal(looksLikeDeliberation("Algeria rejects the proposal and recalls its ambassador."), false);
});

test("the insistence directive is blunt and names the failure", () => {
  assert.match(TOOL_CALL_INSISTENCE, /do not think out loud/i);
  assert.match(TOOL_CALL_INSISTENCE, /function call/i);
});

// A request that does not fit the model — as a gateway said it, in a 200 body,
// for a jump on a 4096-token "foundation" model (a field report).
test("a context-window refusal in a 200 body is recognised, a long real answer is not", () => {
    assert.equal(isContextWindowErrorText("Context window exceeded Your conversation has 0 tokens but the maximum is 4096. Please start a new conversation or reduce the message length."), true);
    assert.equal(isContextWindowErrorText("This model's maximum context length is 8192 tokens. However, you requested 21000 tokens."), true);
    assert.equal(isContextWindowErrorText("Prompt is too long: 120000 tokens > 100000 maximum"), true);
    assert.equal(isContextWindowErrorText(""), false);
    assert.equal(isContextWindowErrorText('{"events":[{"date":"2016-01-05","title":"Trade talks"}]}'), false);
    // A genuine answer that mentions context windows in passing is far longer than a refusal.
    const essay = `${"The context window of a model is one constraint among many. ".repeat(20)}`;
    assert.equal(essay.length > 600, true);
    assert.equal(isContextWindowErrorText(essay), false);
});

test("a context-window error payload is recognised by code or by text, and a busy one is not", () => {
    assert.equal(isContextWindowErrorPayload({ code: "context_length_exceeded", message: "..." }), true);
    assert.equal(isContextWindowErrorPayload({ message: "This model's maximum context length is 4096 tokens." }), true);
    assert.equal(isContextWindowErrorPayload("Input is too long for requested model."), true);
    assert.equal(isContextWindowErrorPayload({ code: "overloaded_error", message: "Overloaded" }), false);
    assert.equal(isContextWindowErrorPayload(null), false);
});

test("the context-window message names the provider, the refusal and the request size", () => {
    const message = contextWindowMessage("My gateway", "Context window exceeded", 120000);
    assert.match(message, /^My gateway cannot fit this request in the model's context window: it answered "Context window exceeded"\./);
    assert.match(message, /about 30,000 tokens \(120,000 characters/);
    assert.match(message, /32k tokens or more/);
    assert.doesNotMatch(contextWindowMessage("X", "no", 0), /tokens \(/);
});

// ---------------------------------------------------------------------------
// Sorting a failed call for the Fallback list (docs/world-state.md, AI access)
// ---------------------------------------------------------------------------

const GEMINI_PER_DAY = {
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "You exceeded your current quota, please check your plan and billing details.",
    details: [{
      "@type": "type.googleapis.com/google.rpc.QuotaFailure",
      violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
    }],
  },
};

test("a used-up daily allowance is Spent", () => {
  assert.equal(classifyProviderFailure({ status: 429, payload: GEMINI_PER_DAY }).kind, "spent");
});

// TRANSCRIBED FROM A REAL ANSWER (gemini-3.7-flash, free tier, 2026-09-14), key
// removed. The quota id says per DAY, but the message links to ".../rate-limits"
// and "ai.dev/rate-limit" and says "Please retry in 47s", and a RetryInfo rides
// along. The link text used to win: the list waited on a model that was used up
// until midnight Pacific, and never moved to the next one.
const GEMINI_PER_DAY_REAL = {
  error: {
    code: 429,
    message: "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.7-flash\nPlease retry in 47.307372861s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "Learn more about Gemini API quotas", url: "https://ai.google.dev/gemini-api/docs/rate-limits" }] },
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{
          quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
          quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
          quotaDimensions: { location: "global", model: "gemini-3.7-flash" },
          quotaValue: "20",
        }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "47s" },
    ],
  },
};

test("Google's real per-day answer is Spent, whatever its links and retry hint say", () => {
  assert.equal(isQuotaExhaustedPayload(GEMINI_PER_DAY_REAL), true);
  assert.equal(classifyProviderFailure({ status: 429, payload: GEMINI_PER_DAY_REAL }).kind, "spent");
  // The same answer for a per-minute trip is still a rate limit: the quota id
  // decides, in both directions.
  const perMinute = JSON.parse(JSON.stringify(GEMINI_PER_DAY_REAL).replace("GenerateRequestsPerDayPerProjectPerModel", "GenerateRequestsPerMinutePerProjectPerModel"));
  assert.equal(classifyProviderFailure({ status: 429, payload: perMinute }).kind, "rateLimited");
});

test("each provider's spelling of a spent allowance or balance is Spent", () => {
  // OpenAI
  assert.equal(classifyProviderFailure({ status: 429, payload: { error: { code: "insufficient_quota", type: "insufficient_quota", message: "You exceeded your current quota, please check your plan and billing details." } } }).kind, "spent");
  // Anthropic, which says it with a 400
  assert.equal(classifyProviderFailure({ status: 400, payload: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } } }).kind, "spent");
  // A gateway's 402
  assert.equal(classifyProviderFailure({ status: 402, payload: { error: { message: "Payment required" } } }).kind, "spent");
});

test("an overloaded provider is busy", () => {
  assert.equal(classifyProviderFailure({ status: 503, payload: { error: { code: 503, status: "UNAVAILABLE", message: "The model is overloaded. Please try again later." } } }).kind, "busy");
  // Anthropic's overloaded_error has a status code of its own.
  assert.equal(classifyProviderFailure({ status: 529, payload: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }).kind, "busy");
  assert.equal(classifyProviderFailure({ status: 502, payload: { rawText: "error code: 502" } }).kind, "busy");
  // Refused inside a 200 stream: no status to go on, only the frame.
  assert.equal(classifyProviderFailure({ payload: { message: "Service temporarily overloaded", type: "service_unavailable" } }).kind, "busy");
});

test("a rejected key or an unknown model is Unusable, with a reason the player can act on", () => {
  assert.deepEqual(classifyProviderFailure({ status: 401, payload: { error: { message: "Incorrect API key provided: sk-abc***.", code: "invalid_api_key" } } }), {
    kind: "unusable", reason: "key rejected (401)",
  });
  assert.equal(classifyProviderFailure({ status: 403, payload: { error: { code: 403, status: "PERMISSION_DENIED", message: "Permission denied." } } }).reason, "key rejected (403)");
  // Gemini says a bad key with a 400.
  assert.deepEqual(classifyProviderFailure({ status: 400, payload: { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } } }), {
    kind: "unusable", reason: "key rejected (400)",
  });
  assert.deepEqual(classifyProviderFailure({ status: 404, payload: { error: { code: 404, message: "models/gemini-9-flash is not found for API version v1beta, or is not supported for generateContent." } } }), {
    kind: "unusable", reason: "model not found (404)",
  });
  assert.equal(classifyProviderFailure({ status: 404, payload: { error: { message: "models/gemini-3.9-flash is not found for API version v1beta." } } }).reason, "model not found (404)");
  assert.equal(classifyProviderFailure({ status: 404, payload: { error: { message: "The model `gpt-9` does not exist or you do not have access to it.", code: "model_not_found" } } }).reason, "model not found (404)");
  // Busy is not mistaken for a missing model just because it names the model.
  assert.equal(classifyProviderFailure({ status: 503, payload: { error: { message: "The model gemini-3.5-flash is overloaded. Please try again later." } } }).kind, "busy");
  // Ollama and friends say it with a 400.
  assert.equal(classifyProviderFailure({ status: 400, payload: { error: { message: "model 'qwen9' not found, try pulling it first" } } }).reason, "model not found (400)");
  // A 404 that is not about a model is the address being wrong.
  assert.deepEqual(classifyProviderFailure({ status: 404, payload: { rawText: "Cannot POST /v2/chat/completions" } }), {
    kind: "unusable", reason: "not found (404): check the endpoint address",
  });
});

test("a request too big for this model's window is 'tooBig' — the next entry's window may take it — with the wording kept", () => {
  assert.deepEqual(
    classifyProviderFailure({ status: 400, payload: { error: { code: "context_length_exceeded", message: "This model's maximum context length is 4096 tokens." } } }),
    { kind: "tooBig", reason: "This model's maximum context length is 4096 tokens." },
  );
});

test("a failure that would happen on any model is not a reason to fall back", () => {
  assert.equal(classifyProviderFailure({ status: 400, payload: { error: { message: "Invalid JSON payload received. Unknown name \"foo\"." } } }).kind, "other");
  assert.equal(classifyProviderFailure({ status: 500, payload: { error: { message: "Internal error" } } }).kind, "other");
  assert.equal(classifyProviderFailure({}).kind, "other");
});

test("a provider retries a failure only where the Fallback list rules say it should", () => {
  const retry = (kind, { attempt = 1, retries = 3, canFallBack = true, rateLimitPolicy = "next" } = {}) =>
    shouldRetryProviderFailure({ failure: { kind }, attempt, retries, canFallBack, rateLimitPolicy });

  // Waiting fixes none of these, so asking again is a wasted request.
  for (const kind of ["spent", "unusable", "other"]) assert.equal(retry(kind), false, kind);

  // Busy, with a backup: the next model answers now, and the call after this
  // one starts at the top again anyway (fallbackRunner.js).
  assert.equal(retry("busy", { attempt: 1 }), false);

  // Rate limited: the same, unless the player chose to wait.
  assert.equal(retry("rateLimited", { attempt: 1 }), false);
  assert.equal(retry("rateLimited", { attempt: 2, rateLimitPolicy: "wait" }), true);
  assert.equal(retry("rateLimited", { attempt: 3, rateLimitPolicy: "wait" }), false, "out of attempts");

  // Nowhere to fall back to: today's full retries, because giving up early
  // would only lose the turn sooner.
  assert.equal(retry("busy", { attempt: 2, canFallBack: false }), true);
  assert.equal(retry("busy", { attempt: 3, canFallBack: false }), false);
  assert.equal(retry("rateLimited", { attempt: 1, canFallBack: false }), true);
});

test("a per-minute limit is Rate limited, and carries the wait the provider asked for", () => {
  const perMinute = {
    error: {
      code: 429,
      message: "You exceeded your current quota, please check your plan and billing details.",
      details: [
        { violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "35s" },
      ],
    },
  };
  assert.deepEqual(classifyProviderFailure({ status: 429, payload: perMinute }), {
    kind: "rateLimited", reason: "rate limited", waitMs: 35000,
  });
  assert.equal(classifyProviderFailure({ status: 429, payload: { error: { type: "rate_limit_exceeded", message: "Rate limit reached for gpt-5 in organization org-x on requests per min (RPM)" } } }).kind, "rateLimited");
  // No RetryInfo: the wait is unknown, and the caller picks its own.
  assert.deepEqual(classifyProviderFailure({ status: 429, payload: { error: { message: "Too many requests" } } }), {
    kind: "rateLimited", reason: "rate limited", waitMs: null,
  });
});

// ---------------------------------------------------------------------------
// An answer that stopped before it was finished

test("the two sentences for an unfinished answer are the ones the language packs carry", () => {
  assert.equal(CONNECTION_CLOSED_MESSAGE, "The connection closed before the model finished its answer.");
  assert.equal(OUTPUT_LIMIT_MESSAGE, "The model stopped at its output limit before it finished its answer.");
});

test("a closed connection is an error that says so and keeps what the transport reported", () => {
  const bare = connectionClosedError();
  assert.equal(bare.message, CONNECTION_CLOSED_MESSAGE);
  assert.equal(bare.cause, undefined);
  const network = new TypeError("network error");
  assert.equal(connectionClosedError(network).cause, network);
});

test("a structured answer whose stream ended without an end marker stands only when it arrived whole", () => {
  assert.equal(judgeUnmarkedEnd({ structured: true, whole: true, text: '{"events":[]}' }), UNMARKED_END.keep);
  assert.equal(judgeUnmarkedEnd({ structured: true, whole: false, text: '{"events":[{"title":"The fle' }), UNMARKED_END.fail);
  // Prose where JSON was asked for is not the answer, however much of it came.
  assert.equal(judgeUnmarkedEnd({ structured: true, whole: false, text: "Let me think about the period first." }), UNMARKED_END.fail);
  assert.equal(judgeUnmarkedEnd({ structured: true }), UNMARKED_END.fail);
});

test("a chat reply whose stream ended without an end marker is kept, and said: some gateways never send one", () => {
  // No finish reason and no [DONE] on any reply: failing these would fail
  // every reply such a gateway gives.
  assert.equal(judgeUnmarkedEnd({ structured: false, text: "The harvest will hold, Majesty, if the roads do." }), UNMARKED_END.keepAndSay);
  assert.equal(judgeUnmarkedEnd({ text: "Yes." }), UNMARKED_END.keepAndSay);
  // `whole` is a question about JSON and says nothing about prose.
  assert.equal(judgeUnmarkedEnd({ structured: false, whole: false, text: "Half a sent" }), UNMARKED_END.keepAndSay);
});

test("an empty chat reply with no end marker is the connection closing before anything came", () => {
  for (const text of ["", "   ", "\n\n", null, undefined]) {
    assert.equal(judgeUnmarkedEnd({ structured: false, text }), UNMARKED_END.fail, JSON.stringify(text));
  }
  assert.equal(judgeUnmarkedEnd(), UNMARKED_END.fail);
});

// ---------------------------------------------------------------------------
// A server that could not be reached
//
// From a player's log: their local model server went down mid-answer. The skip
// failed with "TypeError: network error" under a note blaming the provider URL,
// key or model name, and each request after it was made three times, 15 s
// apart, to be told "OpenAI Compatible is busy right now."

test("Chromium's mid-answer 'network error' is a dead connection, like a failed fetch", () => {
  // What a fetch body stream throws when the connection breaks mid-response.
  assert.equal(isUnreachableError(new TypeError("network error")), true);
  assert.equal(isBrokenConnectionError(new TypeError("network error")), true);
  assert.equal(isBrokenConnectionError(new TypeError("Error in input stream")), true, "Firefox");
  assert.equal(isBrokenConnectionError(new TypeError("terminated")), true, "Node");
  // Never connected at all: unreachable, and not a break mid-answer.
  for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "fetch failed", "Network request failed"]) {
    assert.equal(isUnreachableError(new TypeError(message)), true, message);
    assert.equal(isBrokenConnectionError(new TypeError(message)), false, message);
  }
});

test("a TypeError from the game's own code is never taken for a dead connection", () => {
  for (const error of [
    new TypeError("Cannot read properties of undefined (reading 'choices')"),
    new TypeError("a network error occurred while parsing"),
    new TypeError("the request was terminated by the validator"),
    new Error("network error"),
    new DOMException("The operation was aborted.", "AbortError"),
    null,
  ]) {
    assert.equal(isUnreachableError(error), false, String(error?.message));
    assert.equal(isBrokenConnectionError(error), false, String(error?.message));
  }
});

test("a connection that closed mid-answer is a server that could not be reached, for the Fallback list", () => {
  const { providerFailure } = connectionClosedError(new TypeError("network error"));
  assert.equal(providerFailure.kind, "busy", "the list skips it for a minute and tries the next entry");
  assert.equal(isUnreachableFailure(providerFailure), true);
  assert.equal(providerFailure.midAnswer, true, "and the report blames the connection, not the provider settings");
  assert.deepEqual(UNREACHABLE_FAILURE, { kind: "busy", reason: "could not be reached" });
  assert.equal(isUnreachableFailure({ kind: "busy", reason: "busy" }), false);
});

test("a call that failed with the connection is marked for the Fallback list, each kind in its own way", () => {
  // Never connected: the browser's own error, marked.
  const refused = new TypeError("Failed to fetch");
  assert.equal(asUnreachable(refused), refused);
  assert.deepEqual(refused.providerFailure, { kind: "busy", reason: "could not be reached" });

  // Broke mid-answer: the bare "network error" becomes the sentence that says so.
  const network = new TypeError("network error");
  const closed = asUnreachable(network);
  assert.notEqual(closed, network);
  assert.equal(closed.message, CONNECTION_CLOSED_MESSAGE);
  assert.equal(closed.cause, network);
  assert.deepEqual(closed.providerFailure, { kind: "busy", reason: "could not be reached", midAnswer: true });

  // Broke on the way through the relay: its own sentence is kept.
  const relayed = new Error(RELAY_CUT_OFF_MESSAGE, { cause: new TypeError("network error") });
  assert.equal(asUnreachable(relayed), relayed);
  assert.equal(relayed.message, RELAY_CUT_OFF_MESSAGE);
  assert.deepEqual(relayed.providerFailure, { kind: "busy", reason: "could not be reached", midAnswer: true });
});

test("the provider's own failure, the player's cancel and anything else are left alone", () => {
  const spent = Object.assign(new Error("quota used up"), { providerFailure: { kind: "spent", reason: "used today's allowance" } });
  assert.equal(asUnreachable(spent).providerFailure.kind, "spent");

  const cancel = new DOMException("Timeline jump cancelled.", "AbortError");
  assert.equal(asUnreachable(cancel), cancel);
  assert.equal(cancel.providerFailure, undefined);

  // The player cancelled while the connection was failing: still a cancel.
  const controller = new AbortController();
  controller.abort();
  const duringCancel = new TypeError("network error");
  assert.equal(asUnreachable(duringCancel, controller.signal), duringCancel);
  assert.equal(duringCancel.providerFailure, undefined);

  const bug = new TypeError("Cannot read properties of undefined (reading 'choices')");
  assert.equal(asUnreachable(bug), bug);
  assert.equal(bug.providerFailure, undefined);
  assert.equal(asUnreachable(null), null);
});

test("the relay's 'could not reach the endpoint' is not a busy provider, and is never waited on", () => {
  // What the game server's relay answers when nothing is listening (server/server.js).
  const refused = { error: "connect ECONNREFUSED 127.0.0.1:5001", code: "ECONNREFUSED", unreachable: true };
  const failure = classifyProviderFailure({ status: 502, payload: refused });
  assert.deepEqual(failure, { kind: "busy", reason: "could not be reached" });
  for (const canFallBack of [true, false]) {
    assert.equal(shouldRetryProviderFailure({ failure, attempt: 1, retries: 3, canFallBack, rateLimitPolicy: "wait" }), false,
      "no waiting on a server that is not there");
  }
  assert.equal(extractErrorMessage(refused, "OpenAI Compatible is busy right now. Try again in a moment."), "connect ECONNREFUSED 127.0.0.1:5001",
    "and the message is what failed, not the busy wording");
});

test("a server the relay could not reach is an error that names it, says why, and says what to check", () => {
  const error = unreachableServerError("http://localhost:5001", "ECONNREFUSED");
  // The sentence the language packs carry, as a pattern with the address and
  // the reason as its two slots.
  assert.equal(error.message,
    "http://localhost:5001 could not be reached (ECONNREFUSED). Check that the AI server is running and that its address in Settings → AI is right.");
  // For the Fallback list: skipped for a minute, never waited on, and not a
  // connection that broke mid-answer (it never answered at all).
  assert.deepEqual(error.providerFailure, { kind: "busy", reason: "could not be reached" });
  assert.equal(isUnreachableFailure(error.providerFailure), true);
  assert.equal(shouldRetryProviderFailure({ failure: error.providerFailure, attempt: 1, retries: 3, canFallBack: false }), false);
  // Already marked, so its way to the list leaves it as it is.
  assert.equal(asUnreachable(error), error);
  assert.equal(error.cause, undefined);
  const socket = new Error("connect ECONNREFUSED 127.0.0.1:5001");
  assert.equal(unreachableServerError("http://localhost:5001", "ECONNREFUSED", socket).cause, socket);
});

test("a provider's own 502, 503 or 529 stays busy, and is retried as before", () => {
  for (const [status, payload] of [
    [502, { error: { message: "Bad gateway" } }],
    [502, { rawText: "<html><body>502 Bad Gateway</body></html>" }],
    [503, { error: { message: "Service temporarily overloaded", type: "service_unavailable" } }],
    [529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }],
  ]) {
    const failure = classifyProviderFailure({ status, payload });
    assert.deepEqual(failure, { kind: "busy", reason: "busy" }, `${status}`);
    assert.equal(shouldRetryProviderFailure({ failure, attempt: 1, retries: 3, canFallBack: false }), true, `${status}`);
  }
});

test("an error response's message is read in every shape, a bare string included", () => {
  assert.equal(extractErrorMessage({ error: { message: "Invalid API key" } }, "fallback"), "Invalid API key");
  assert.equal(extractErrorMessage({ error: "model 'qwen3' not found" }, "fallback"), "model 'qwen3' not found");
  assert.equal(extractErrorMessage({ message: "Too many requests" }, "fallback"), "Too many requests");
  assert.equal(extractErrorMessage({ rawText: "upstream timed out" }, "fallback"), "upstream timed out");
  assert.equal(extractErrorMessage("plain text", "fallback"), "plain text");
  for (const empty of [null, undefined, {}, { error: "   " }, { error: {} }]) assert.equal(extractErrorMessage(empty, "fallback"), "fallback");
  assert.match(extractErrorMessage({ rawText: MISSING_SCHEME_PAGE }, "OpenAI Compatible request failed (404)"), /answered with a web page/);
});

test("the relay cut-off sentence names the setting that lengthens the wait", () => {
  assert.match(RELAY_CUT_OFF_MESSAGE, /cut off partway through the game server.s relay/);
  assert.match(RELAY_CUT_OFF_MESSAGE, /OH_RELAY_TIMEOUT_MS/);
});
