// Runs in a BARE CHECKOUT: providerErrors.js is import-free on purpose.
import test from "node:test";
import assert from "node:assert/strict";

import {
  busyProviderMessage,
  errorPayloadText,
  isBusyErrorPayload,
  providerErrorReplyMessage,
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
