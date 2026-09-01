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

// Is this 429 the kind that waiting will NOT fix? Only then is it worth failing
// the turn over.
export const isQuotaExhaustedPayload = (error) => {
    const haystack = errorHaystack(error);
    if (!haystack) return false;
    // A per-minute limit that also happens to mention billing boilerplate ("check
    // your plan and billing details" is in Gemini's generic 429 blurb) is still a
    // per-minute limit, so the retryable signal wins the tie.
    if (RATE_LIMITED_TEXT.test(haystack)) return false;
    return QUOTA_SPENT_TEXT.test(haystack);
};

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
