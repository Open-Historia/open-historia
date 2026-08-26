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
