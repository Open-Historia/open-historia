// Reading the error a provider sends INSTEAD of an answer, and turning it into
// something the player can act on.
//
// A provider under load does not always answer with an HTTP 503. The busy ones
// answer 200, open an event stream, and put the refusal inside it:
//
//   {"error":{"message":"Service temporarily overloaded","type":"service_unavailable","code":503}}
//
// main.jsx's status-code retry never sees that — the status was 200 — and
// neither did anything else: the frame carried no content delta, so the reply
// came back empty and the player was told their model might be out of context
// and to try a shorter message. It was none of those things. The provider was
// busy, and waiting five seconds would have fixed it.
//
// DELIBERATELY IMPORT-FREE, the same as advisorBlocks.js: nothing in main.jsx
// can be unit-tested (it reaches settings, fetch and the DOM), and deciding
// whether a provider is merely busy is exactly the kind of string handling that
// needs to be.

// The human-readable part of an error payload, whatever shape it arrived in.
// Gateways disagree on which field carries the text, and some send a bare
// string, so try each in the order they are worth showing.
export const errorPayloadText = (error) => {
    if (!error) return "";
    if (typeof error === "string") return error.trim();
    return String(error.message ?? error.detail ?? error.type ?? error.code ?? "").trim();
};

// Deliberately generous. A wrong guess here costs one extra request five seconds
// later; a missed one costs the player their turn and tells them to go and debug
// a model that was never the problem.
const BUSY_ERROR_CODES = new Set([
    "429", "502", "503", "504",
    "service_unavailable", "unavailable", "overloaded", "overloaded_error",
    "rate_limit_error", "rate_limit_exceeded", "resource_exhausted", "capacity_exceeded",
]);

const BUSY_ERROR_TEXT = /overload|capacity|too many requests|rate.?limit|temporarily unavailable|service unavailable|currently unavailable|try again later|server is busy|is busy/i;

// Was this the provider being busy, rather than anything wrong with the request?
// Checked against the code/type/status fields first (Anthropic's
// "overloaded_error", Gemini's "UNAVAILABLE", the OpenAI-shaped
// "service_unavailable"), then against the message text, which is all some
// gateways send.
export const isBusyErrorPayload = (error) => {
    if (!error) return false;
    if (typeof error === "object") {
        for (const key of ["code", "type", "status"]) {
            const value = String(error[key] ?? "").toLowerCase();
            if (value && BUSY_ERROR_CODES.has(value)) return true;
        }
    }
    return BUSY_ERROR_TEXT.test(errorPayloadText(error));
};

// ---------------------------------------------------------------------------
// Telling a rate limit apart from a spent quota
// ---------------------------------------------------------------------------
//
// HTTP 429 is two completely different situations wearing the same status code:
//
//   Rate limited — too many requests in the last minute. Waiting fixes it. This
//                  is what a free-tier key hits constantly, and it is the common
//                  case by a wide margin.
//   Quota spent  — the daily allowance or the billing balance is gone. Waiting
//                  fifteen seconds fixes nothing, so failing fast is kinder than
//                  three retries that cannot possibly succeed.
//
// Gemini answered BOTH with the same fatal "your balance or quota appears to be
// exhausted" and never retried, so a single per-minute trip on the free tier
// cost the player a whole timeline jump and dropped them to canned events —
// while every other provider simply retried the same status code.
//
// Default to RETRYABLE. A wrong guess here costs one wasted request; the
// opposite costs a turn.

// Matched against the whole serialized error, because the decisive evidence is
// often not in `message` at all but in Google's quota id
// ("GenerateRequestsPerDayPerProjectPerModel-FreeTier"). No trailing \b: the ids
// are camelCase, so "PerDay" has to match inside "PerDayPerProject".
const QUOTA_SPENT_TEXT =
    /per\s*-?\s*day|\bdaily\b|billing|payment|credit balance|insufficient[_ ]?quota|plan and billing/i;
const RATE_LIMITED_TEXT =
    /per\s*-?\s*minute|per\s*-?\s*second|\brpm\b|too many requests|rate.?limit/i;

const errorHaystack = (error) => {
    if (!error) return "";
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error.error ?? error);
    } catch {
        return errorPayloadText(error.error ?? error);
    }
};

// Google's own quota ids ("GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
// wherever they sit in the payload.
const quotaIdsOf = (node, found = [], depth = 0) => {
    if (!node || typeof node !== "object" || depth > 6) return found;
    for (const [field, value] of Object.entries(node)) {
        if (field === "quotaId" && typeof value === "string") found.push(value);
        else quotaIdsOf(value, found, depth + 1);
    }
    return found;
};

// Is this 429 the kind that waiting will NOT fix? Only then is it worth failing
// the turn over.
export const isQuotaExhaustedPayload = (error) => {
    // The quota id, when there is one, is the answer: Google names the window
    // that ran out. Everything else in its 429 is boilerplate that says both
    // things at once — every one, per-day included, carries a "retry in 47s"
    // hint and links to ".../rate-limits" — and the wording below once read a
    // spent day as a one-minute pause and left the list waiting on it.
    const quotaIds = quotaIdsOf(typeof error === "object" ? error : null);
    if (quotaIds.some((id) => /PerDay/i.test(id))) return true;
    if (quotaIds.length && quotaIds.every((id) => /PerMinute|PerSecond/i.test(id))) return false;
    // No quota id: judge the words, minus any URL (a help link to a "rate-limits"
    // page says nothing about which limit this was).
    const haystack = errorHaystack(error).replace(/https?:\/\/[^\s"\\]+/g, " ");
    if (!haystack.trim()) return false;
    // A per-minute limit that also happens to mention billing boilerplate ("check
    // your plan and billing details" is in Gemini's generic 429 blurb) is still a
    // per-minute limit, so the retryable signal wins the tie.
    if (RATE_LIMITED_TEXT.test(haystack)) return false;
    return QUOTA_SPENT_TEXT.test(haystack);
};

// ---------------------------------------------------------------------------
// Sorting a failed call for the Fallback list
// ---------------------------------------------------------------------------
//
// The Fallback list (fallbackRunner.js) moves a call down to the next entry
// only for failures that say something about the ENTRY: its allowance is Spent,
// it is Unusable (a bad key, a model the provider does not know), or it is
// Rate limited or busy for the moment — and for one that says something about
// the REQUEST: it is too big for this model's context window ("tooBig"), which
// the next entry's larger window may take. Everything else is "other" and is
// never a reason to change model: a malformed answer is the task runner's
// business, not the list's.
export const classifyProviderFailure = ({ status, payload } = {}) => {
    const code = Number(status) || 0;
    const error = payload?.error ?? payload;
    const text = errorPayloadText(error) || String(payload?.rawText ?? "");
    // The game server's relay could not reach the endpoint at all (its own
    // mark; see "A server that could not be reached" below). The status is a
    // 502 like a busy provider's, and it is not that.
    if (payload?.unreachable === true) return { ...UNREACHABLE_FAILURE };
    // First: it is not the entry's fault, and the next entry may fit it. The
    // wording is kept — contextWindow.js reads the numbers out of it.
    if (isContextWindowErrorPayload(error)) return { kind: "tooBig", reason: text };
    if (isQuotaExhaustedPayload(payload)) return { kind: "spent", reason: "used today's allowance" };
    if (code === 429) return { kind: "rateLimited", reason: "rate limited", waitMs: retryDelayMsFromPayload(payload) };
    if (code === 401 || code === 403 || BAD_KEY_TEXT.test(text)) return { kind: "unusable", reason: `key rejected (${code || "no status"})` };
    if (MODEL_NOT_FOUND_TEXT.test(text)) return { kind: "unusable", reason: `model not found (${code || "no status"})` };
    if (code === 404) return { kind: "unusable", reason: "not found (404): check the endpoint address" };
    if (BUSY_HTTP_STATUSES.has(code) || isBusyErrorPayload(error)) return { kind: "busy", reason: "busy" };
    return { kind: "other", reason: text };
};

// Whether a provider should ask the same entry again, or give up and let the
// Fallback list move on. Shared by every provider path so they agree:
//
//   Spent, Unusable, other — never; waiting fixes none of them.
//   Busy — never while there is a backup: the next entry answers at once, and
//          the next call starts at the top again, by when the spell is usually
//          over (fallbackRunner.js).
//   Rate limited — the same, unless the player chose to wait (Settings → AI,
//                  "wait"; the default is "next").
//
// With no entry left to fall back to, busy and Rate limited keep the full retry
// count they had before the list existed: giving up early then would only lose
// the turn sooner.
//
// A server that could not be reached is "busy" for the list and is never waited
// on here: nothing is listening, and asking twice more, fifteen seconds apart,
// only delays saying so.
export const shouldRetryProviderFailure = ({ failure, attempt, retries, canFallBack, rateLimitPolicy } = {}) => {
    const kind = failure?.kind;
    if (kind !== "busy" && kind !== "rateLimited") return false;
    if (isUnreachableFailure(failure)) return false;
    if (attempt >= retries) return false;
    if (!canFallBack) return true;
    return kind === "rateLimited" && rateLimitPolicy === "wait";
};

// 529 is Anthropic's own status for overloaded_error.
const BUSY_HTTP_STATUSES = new Set([502, 503, 504, 529]);

// ---------------------------------------------------------------------------
// A server that could not be reached
// ---------------------------------------------------------------------------
//
// A local model that is not running, the network down, a connection that broke
// while the answer was arriving. For the Fallback list it is "busy": worth
// skipping for a minute, and worth trying again after. It is not a busy
// PROVIDER, though, and a player's log shows what treating it as one cost: the
// model server went down mid-answer, the skip failed with a bare "network
// error" and a note blaming the provider URL, key or model name, and every
// request after it was made three times, fifteen seconds apart, to be told the
// server "is busy right now".
//
// It arrives three ways, and all three end in the same failure:
//   - fetch() rejects: the browser could not connect at all;
//   - a body reader rejects: the connection broke once the answer had started;
//   - the game server's relay answers 502 with `unreachable: true`, because the
//     browser's request reached the relay and the relay's did not reach the
//     endpoint (server/server.js).
export const UNREACHABLE_FAILURE = Object.freeze({ kind: "busy", reason: "could not be reached" });
export const isUnreachableFailure = (failure) => failure?.kind === "busy" && failure?.reason === UNREACHABLE_FAILURE.reason;

// Matched on the runtimes' own wording, so a TypeError from a bug in the game's
// own code is never mistaken for a dead connection.
//   Could not connect: Chromium's "Failed to fetch", Firefox's "NetworkError
//   when attempting to fetch resource.", Safari's "Load failed", Node's "fetch
//   failed", React Native's "Network request failed".
const UNREACHABLE_TEXT = /failed to fetch|fetch failed|networkerror|load failed|network request failed/i;
//   Broke mid-answer: what a fetch body stream throws. Chromium says a bare
//   "network error" (which the list above never matched, so it was no kind of
//   failure the Fallback list knew), Firefox "Error in input stream", Node
//   "terminated".
const BROKEN_CONNECTION_TEXT = /^\s*(?:network error|terminated)\s*$|error in input stream/i;

export const isBrokenConnectionError = (error) => error instanceof TypeError && BROKEN_CONNECTION_TEXT.test(String(error.message));
export const isUnreachableError = (error) => error instanceof TypeError
    && (UNREACHABLE_TEXT.test(String(error.message)) || BROKEN_CONNECTION_TEXT.test(String(error.message)));

// A call that failed without the provider saying why, because the connection to
// it did. Returns the error the caller should throw, marked for the Fallback
// list; anything else (the provider's own failure, the player's cancel) comes
// back untouched.
//   - Never connected: the error is left as the runtime gave it, and marked.
//   - Broke once the answer had started: the runtime says only "network error",
//     which went on to the player as the reason a turn failed. It becomes the
//     error a stream that closed unfinished raises (connectionClosedError), so
//     the two are one failure with one sentence.
//   - Broke on the way through the relay: relayResponse.js has already given it
//     a sentence of its own and kept the runtime's error as the cause.
export const asUnreachable = (error, signal) => {
    if (error?.providerFailure || signal?.aborted || error?.name === "AbortError") return error;
    if (isBrokenConnectionError(error)) return connectionClosedError(error);
    if (isBrokenConnectionError(error?.cause)) error.providerFailure = { ...UNREACHABLE_FAILURE, midAnswer: true };
    else if (isUnreachableError(error)) error.providerFailure = { ...UNREACHABLE_FAILURE };
    return error;
};

// The message of an error response, whatever shape it came in. A bare string
// under `error` is how the game server's own routes say it, the AI relay among
// them, and some local servers too; it used to be skipped, so a relayed
// "connection refused" was reported in the fallback's words, as a busy provider.
export const extractErrorMessage = (payload, fallback) => {
    if (!payload) return fallback;
    if (typeof payload === "string" && payload.trim()) return describeHtmlErrorPage(payload, fallback) || payload.trim();
    if (payload.error?.message) return payload.error.message;
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    if (payload.message) return payload.message;
    if (typeof payload.rawText === "string" && payload.rawText.trim()) {
        return describeHtmlErrorPage(payload.rawText, fallback) || payload.rawText.trim();
    }
    return fallback;
};

// Gemini says a bad key with a 400, so the status alone is not enough.
const BAD_KEY_TEXT = /api key not valid|invalid api key|incorrect api key|invalid x-api-key|invalid_api_key|api key expired/i;

// Each provider's way of saying the model does not exist: Gemini's "is not
// found for API version", OpenAI's "does not exist", Ollama's "model 'x' not
// found".
// Model ids carry dots ("gemini-3.5-flash"), so the gap may too.
const MODEL_NOT_FOUND_TEXT = /model_not_found|\bmodels?\b[^\n]{0,100}?\b(?:not found|does not exist|is not supported for generateContent)|no such model|unknown model/i;

// Google answers a 429 with a RetryInfo telling you exactly how long to wait:
//   {"error":{"details":[{"@type":".../google.rpc.RetryInfo","retryDelay":"35s"}]}}
// Honouring it beats a fixed 15s guess in both directions. Returns null when the
// provider did not say, so the caller keeps its own default.
export const retryDelayMsFromPayload = (error) => {
    const haystack = errorHaystack(error);
    if (!haystack) return null;
    const match = /"retry(?:_?delay|-?after)"\s*:\s*"?(\d+(?:\.\d+)?)s?"?/i.exec(haystack);
    if (!match) return null;
    const seconds = Number(match[1]);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    // Cap it: a provider asking for an hour is telling you to give up, not to
    // hold a jump open that long.
    return Math.min(Math.round(seconds * 1000), 120000);
};

// ---------------------------------------------------------------------------
// The model thought out loud instead of calling the tool
// ---------------------------------------------------------------------------
//
// main.jsx already recovers from "it spent its whole budget reasoning", but that
// test reads the `reasoning` / `reasoning_content` DELTA FIELDS. Plenty of
// models put their chain of thought straight into `content` instead, which is
// indistinguishable from an answer by field alone.
//
// Field report: an NVIDIA model on openai-compatible fell back on 3 of 4 turns
// against a round-356 save. Every jump came back with viaToolCall:false and text
// like:
//
//   "We need to produce JSON with events between 2032-11-15 and 2033-02-13...
//    We must produce events with dates spread across period. Probably 11 events.
//    We need to include projectOps for each project that needs decision..."
//
// It planned until the budget ran out and never emitted the call. Both attempts
// were spent on it, so the turn fell back to canned events. Its small-schema task
// (idleDiplomacy) succeeded every time, so the model is capable — it is the size
// of the jump contract that tips it into deliberating.
//
// Note this only has to be judged in TOOL mode, where any text without a tool
// call is ALREADY a failure. So the question is not "is this prose?" but "is
// retrying worth one more request?", and the bar is correspondingly low.

// First-person planning, in the register models actually use. Anchored at a
// sentence start so a legitimate answer that happens to contain "we need" in
// narration does not match.
const DELIBERATION_TEXT =
    /(^|[.!?]\s+|\n)\s*(we|i|let'?s|let me|okay|ok|alright|first|now|so)\b[^.!?\n]{0,60}\b(need|must|should|have to|want|will|can|could|'ll|going to|think|consider|plan|figure|decide|start|begin|produce|generate|write|include|make|use)\b/i;

// A second, cheaper signal: models narrating a plan talk ABOUT the output shape
// rather than producing it.
const DELIBERATION_META = /\b(we|i)\s+(need|have|want|should|must)\s+to\s+(produce|generate|create|output|return|write|include|emit)\b/i;

/**
 * In tool mode, did the model deliberate instead of answering?
 *
 * `text` is the assistant's content when no tool call came back. Returns false
 * for anything that even looks like it might carry a payload — a fenced block or
 * a balanced brace — because that is the tolerant-parsing path's job
 * (jsonSalvage.js), not this one, and retrying would throw away a salvageable
 * answer.
 */
export const looksLikeDeliberation = (text) => {
    const body = String(text ?? "").trim();
    if (!body) return false;
    // Anything that might parse is not ours to judge.
    if (body.includes("```") || body.includes("{") || body.includes("[")) return false;
    return DELIBERATION_META.test(body) || DELIBERATION_TEXT.test(body);
};

// What to add to the system prompt for the one retry. Deliberately blunt and
// short: the model has already read a very long contract and talked itself out
// of answering, so this has to cut through rather than add nuance.
export const TOOL_CALL_INSISTENCE =
    "\n\nCRITICAL: Do NOT think out loud, plan, or explain. Do not write any prose at all. "
    + "Your entire response must be a single call to the provided function. "
    + "Begin the function call immediately.";

// Says whose fault it is, which is the whole point: the previous message sent
// the player off to shorten their question and check their model was healthy,
// and none of that would have helped.
export const busyProviderMessage = (providerLabel, detail, retried) =>
    `${providerLabel} is overloaded right now${detail ? ` — it said: ${detail}` : ""}. `
    + (retried ? "It was still busy when the request was retried five seconds later. " : "")
    + "Nothing is wrong with your game, your model or your message — the provider is under load. Retry in a moment.";

// Not busy, but still an error rather than an answer: quote it rather than
// guessing at a cause.
export const providerErrorReplyMessage = (providerLabel, detail) =>
    `${providerLabel} returned an error instead of a reply${detail ? `: ${detail}` : ""}.`;

// A structured task asked for a tool call and got back nothing at all — no call,
// no text — except the provider's own error inside the stream. The providers retry
// a busy one once; if it is still refusing after that, THIS is what to throw.
//
// Every tool path used to return an empty answer here instead. The task runner
// then logged the provider as having "answered" with 0 characters, told the model
// its reply "did not contain parseable JSON", and re-sent the whole prompt at once
// to a provider that had just said it was overloaded. A DeepSeek V4 Flash field
// report lost two held turns and a jump to exactly that, each one following a
// "reported ... mid-stream; retrying once" warning a few minutes earlier.
//
// `providerRefusal` is how the task runner tells this apart from a real failure:
// there was no answer to correct, so it spends its second attempt re-asking — after
// a proper pause when the provider said it was busy — rather than falling back.
export const toolStreamRefusalError = (providerLabel, error, retried) => {
    const detail = errorPayloadText(error);
    const busy = isBusyErrorPayload(error);
    const refusal = new Error(busy
        ? busyProviderMessage(providerLabel, detail, retried)
        : providerErrorReplyMessage(providerLabel, detail));
    refusal.providerRefusal = { busy, detail };
    // And for the Fallback list: busy after the provider's one retry moves the
    // call to the next entry.
    refusal.providerFailure = classifyProviderFailure({ payload: error });
    return refusal;
};

// ---------------------------------------------------------------------------
// An answer that stopped before it was finished
// ---------------------------------------------------------------------------
//
// Two ways, and neither is the model answering badly:
//
//   The connection closed. The stream ended with nothing to say the provider
//   had finished (streamAssembly.js marks the envelope `endedEarly`), or a
//   buffered body arrived cut short. It is a transport failure, and is thrown
//   as one, rather than passed on as an answer that "did not contain parseable
//   JSON" for the task runner to ask again about.
//
//   The output limit. The provider stopped the model at max_tokens
//   (streamAssembly.js stoppedAtOutputLimit). What arrived is kept when it can
//   still be used. When it cannot, asking again is the same request under the
//   same limit, cut at the same place: a player's log has a local server
//   answering 4,171 characters and then, asked again, 4,173. The task fails
//   with this sentence instead, which names what to change.
export const CONNECTION_CLOSED_MESSAGE = "The connection closed before the model finished its answer.";
export const OUTPUT_LIMIT_MESSAGE = "The model stopped at its output limit before it finished its answer.";

// The error for the first. `cause` is what the transport itself reported, when
// it reported anything. For the Fallback list it is a server that could not be
// reached (below); `midAnswer` says the connection was up and then was not, so
// what the report blames is the connection and not the provider settings
// (gameplay.js, the note a fallback writes in place of a response).
export const connectionClosedError = (cause = null) => {
    const error = new Error(CONNECTION_CLOSED_MESSAGE, cause ? { cause } : undefined);
    error.providerFailure = { ...UNREACHABLE_FAILURE, midAnswer: true };
    return error;
};

// What the player reads when the game server's relay had to stop an answer it
// had already begun to pass on (relayResponse.js puts it on the read error).
// Kept here, with the other messages the player reads, so the language packs
// carry it: relayResponse.js is not a file the catalog is read from.
export const RELAY_CUT_OFF_MESSAGE =
    "The AI answer was cut off partway through the game server's relay. If a local model needs longer, raise OH_RELAY_TIMEOUT_MS on the server.";

// A web page where an API reply should be. It means the endpoint address points
// at a website rather than its API: a gateway's own 404 page, a login screen, a
// proxy's error page, or — when the address has no http(s):// — the game's own
// server answering "Cannot POST /inference.example.com/v1/chat/completions".
//
// The page used to become the error message verbatim. A field report's log
// carried a 10 KB Next.js 404 page in every failed call, a dozen times over,
// until the log had nearly spent its whole 1 MB budget on one misconfigured
// endpoint — and the player saw a wall of markup rather than "check the address".
//
// Returns "" for anything that is not an HTML page, so callers fall back to
// what they did before.
const HTML_PAGE_START = /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html|head|body)\b/i;

const decodeBasicEntities = (text) => text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;|&apos;/gi, "'");

export const describeHtmlErrorPage = (text, fallback) => {
    const body = String(text ?? "");
    if (!HTML_PAGE_START.test(body)) return "";
    // What a person would read on the page: no head (its title is usually the
    // site's marketing line), no scripts or styles, no tags.
    const visible = decodeBasicEntities(body
        .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
        .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
    const title = decodeBasicEntities(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
        .replace(/\s+/g, " ")
        .trim();
    const quoted = (visible || title).slice(0, 160);
    return `${fallback ? `${fallback}: ` : ""}the endpoint answered with a web page instead of an API reply`
        + `${quoted ? ` ("${quoted}${(visible || title).length > 160 ? "…" : ""}")` : ""}. `
        + "Check the endpoint address in Settings — it should be the provider's API base URL, "
        + "starting with https:// and usually ending in /v1.";
};

// Did the provider reject the request because it was STREAMED (rather than for
// anything about its content)? Tool calls stream so a long timeline jump keeps
// the connection warm, but a few gateways refuse stream and tools together, and
// some self-hosted backends refuse streaming outright. Recognising that lets the
// call retry buffered instead of degrading out of tool mode — losing a keep-alive
// is much cheaper than losing structured output.
//
// Anchored on the word "stream" so an unrelated "not supported" (a model that
// cannot do tools at all) still falls through to the structured-output ladder.
const STREAM_REFUSAL_TEXT =
    /stream\w*[^.]{0,80}(?:not\s+support|unsupported|not\s+allowed|not\s+enabled|not\s+available|must\s+be|cannot|can't)/i;
const STREAM_REFUSAL_PARAM =
    /(?:not\s+support|unsupported|invalid|unknown|unrecognized)[^.]{0,80}\bstream\w*/i;
// "This deployment cannot stream responses" — the negation leads, and `stream` is
// the verb rather than the parameter name.
const STREAM_REFUSAL_VERB =
    /(?:cannot|can't|can not|does\s+not|doesn't|will\s+not|won't|unable\s+to)[^.]{0,40}\bstream/i;

export const isStreamingRefusal = (message) => {
    const text = errorPayloadText(message);
    if (!text || !/stream/i.test(text)) return false;
    return STREAM_REFUSAL_TEXT.test(text) || STREAM_REFUSAL_PARAM.test(text) || STREAM_REFUSAL_VERB.test(text);
};

// The opposite complaint, and the reason Anthropic tool calls stream at all: the
// Messages API REFUSES a non-streaming request whose max_tokens implies a long
// generation, and the game sends max_tokens 64000 uncapped. That 400 arrives
// before any tokens are generated, and the existing max_tokens recovery in
// main.jsx only matches ceiling errors ("max_tokens: X > Y"), so without this the
// whole turn fell through to canned events.
const STREAM_REQUIRED_TEXT =
    /streaming\s+is\s+(?:strongly\s+)?(?:required|recommended)|(?:must|should)\s+(?:be\s+)?use\s+streaming|use\s+streaming|stream\w*\s*[:=]\s*true|long[- ]running[^.]{0,60}stream/i;

export const isStreamingRequired = (message) => {
    const text = errorPayloadText(message);
    if (!text || !/stream/i.test(text)) return false;
    return STREAM_REQUIRED_TEXT.test(text);
};

// Did the provider reject the request because it carried a TEMPERATURE?
const TEMPERATURE_REFUSAL =
    /temperature[^.]{0,80}(?:not\s+support|unsupported|not\s+allowed|not\s+enabled|not\s+available|must\s+be|may\s+only|can\s+only|only\s+(?:be\s+set|(?:the\s+)?default)|cannot|can't|invalid)|(?:not\s+support|unsupported|unsupported\s+value|invalid|unknown|unrecognized)[^.]{0,80}\btemperature/i;

export const isTemperatureRefusal = (message) => {
    const text = errorPayloadText(message);
    if (!text || !/temperature/i.test(text)) return false;
    return TEMPERATURE_REFUSAL.test(text);
};

// ---------------------------------------------------------------------------
// The request does not fit the model's context window
// ---------------------------------------------------------------------------
//
// A gateway can say so as a 400 with a code — or, some do, as a perfectly
// normal 200 whose "answer" is the sentence: "Context window exceeded. Your
// conversation has 0 tokens but the maximum is 4096." That used to reach the
// player as "Response did not contain parseable JSON", which sent them hunting
// for a parsing bug in a model that was never asked anything it could answer.
// No retry can help: the retry carries the failed answer too, so it is longer.
const CONTEXT_WINDOW_CODES = new Set([
    "context_length_exceeded", "context_window_exceeded", "max_tokens_exceeded",
    "prompt_too_long", "invalid_prompt_length", "input_too_long",
]);
const CONTEXT_WINDOW_TEXT = /context[ _-]?(?:window|length|size)|maximum context|too many tokens|token limit|prompt is too long|input is too long|reduce the (?:message|prompt|input) length|exceeds? (?:the )?(?:model'?s )?(?:maximum )?(?:number of )?(?:input )?tokens|(?:maximum|max) (?:input|prompt) (?:length|tokens|size)/i;

export const isContextWindowErrorPayload = (error) => {
    if (!error) return false;
    if (typeof error === "object") {
        for (const key of ["code", "type"]) {
            const value = String(error[key] ?? "").toLowerCase();
            if (value && CONTEXT_WINDOW_CODES.has(value)) return true;
        }
    }
    return CONTEXT_WINDOW_TEXT.test(errorHaystack(error));
};

// A 200 whose text IS the refusal rather than an answer. Short on purpose: a
// real answer that happens to discuss context windows is thousands of
// characters long.
export const isContextWindowErrorText = (text) => {
    const value = String(text ?? "").trim();
    return value.length > 0 && value.length <= 600 && CONTEXT_WINDOW_TEXT.test(value);
};

// What the player reads instead of "did not contain parseable JSON".
export const contextWindowMessage = (providerLabel, detail, requestChars = 0) => {
    const chars = Math.max(0, Math.round(Number(requestChars) || 0));
    const size = chars
        ? ` This request was about ${Math.round(chars / 4).toLocaleString("en-US")} tokens (${chars.toLocaleString("en-US")} characters of prompt and history).`
        : "";
    return `${providerLabel} cannot fit this request in the model's context window: it answered "${String(detail ?? "").trim()}".${size} `
        + "A turn needs a model with a large context window (32k tokens or more): pick one in Settings → AI, or a provider that offers one.";
};
