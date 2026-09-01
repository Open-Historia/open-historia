// Runs in a BARE CHECKOUT: providerErrors.js is import-free on purpose.
import test from "node:test";
import assert from "node:assert/strict";

import {
  busyProviderMessage,
  errorPayloadText,
  isBusyErrorPayload,
  isQuotaExhaustedPayload,
  isStreamingRefusal,
  isStreamingRequired,
  providerErrorReplyMessage,
  retryDelayMsFromPayload,
} from "./providerErrors.js";

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
