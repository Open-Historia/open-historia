/*! Open Historia — tests of the player's count of attempts per request © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/requestAttempts.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_REQUEST_ATTEMPTS, MAX_REQUEST_ATTEMPTS, REQUEST_ATTEMPT_CHOICES, requestAttemptsFrom } from "./requestAttempts.js";
import { createRequestActivity } from "./requestActivity.js";
import { shouldRetryProviderFailure } from "./providerErrors.js";

test("nothing stored is the three attempts every provider path had", () => {
  assert.equal(DEFAULT_REQUEST_ATTEMPTS, 3);
  for (const stored of [undefined, null, "", "  "]) assert.equal(requestAttemptsFrom(stored), 3);
});

test("a stored count is used, within 1 and the most", () => {
  assert.equal(requestAttemptsFrom("1"), 1);
  assert.equal(requestAttemptsFrom("20"), 20);
  assert.equal(requestAttemptsFrom(" 10 "), 10);
  assert.equal(requestAttemptsFrom(String(MAX_REQUEST_ATTEMPTS + 50)), MAX_REQUEST_ATTEMPTS);
});

test("a store edited by hand never costs a request its attempts", () => {
  for (const stored of ["0", "-4", "2.5", "many", "1e3", "NaN"]) assert.equal(requestAttemptsFrom(stored), 3);
});

test("every choice Settings offers is a count the game would use, the default among them", () => {
  assert.ok(REQUEST_ATTEMPT_CHOICES.includes(DEFAULT_REQUEST_ATTEMPTS));
  for (const choice of REQUEST_ATTEMPT_CHOICES) assert.equal(requestAttemptsFrom(String(choice)), choice);
});

test("with nowhere to fall back to, a busy provider is asked again until the count is spent", () => {
  const busy = { kind: "busy" };
  const retries = requestAttemptsFrom("10");
  for (let attempt = 1; attempt < retries; attempt += 1) {
    assert.equal(shouldRetryProviderFailure({ failure: busy, attempt, retries, canFallBack: false }), true, `attempt ${attempt}`);
  }
  assert.equal(shouldRetryProviderFailure({ failure: busy, attempt: retries, retries, canFallBack: false }), false);
  // The Fallback list still comes first: the count is the last entry's patience.
  assert.equal(shouldRetryProviderFailure({ failure: busy, attempt: 1, retries, canFallBack: true }), false);
});

test("the open request says which attempt is running, of how many", () => {
  const activity = createRequestActivity({ now: () => 0 });
  const request = activity.open({ label: "a skip", attempts: 10 });
  assert.equal(activity.current().attempt, 1);
  assert.equal(activity.current().attempts, 10);
  request.sent();
  assert.equal(activity.current().attempt, 1, "the first send is the first attempt");
  request.sent();
  request.sent();
  assert.equal(activity.current().attempt, 3);
  // A request opened with no count says none.
  assert.equal(createRequestActivity().open().sent(), undefined);
  const plain = createRequestActivity({ now: () => 0 });
  plain.open({ label: "a call" });
  assert.equal(plain.current().attempts, 0);
});
