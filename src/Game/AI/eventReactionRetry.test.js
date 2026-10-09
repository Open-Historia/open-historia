/*! Open Historia — a failed Event Editor reaction is tried a few times, then given up © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/eventReactionRetry.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_REACTION_MAX_ATTEMPTS,
  eventReactionAfterFailure,
  reactionSpeakerWithContext,
} from "./eventReactionRetry.js";

test("each failure waits longer, and the last one gives the reaction up", () => {
  const waits = [];
  let attempts = 0;
  for (;;) {
    const next = eventReactionAfterFailure(attempts);
    attempts = next.attempts;
    if (next.giveUp) break;
    waits.push(next.retryAfterMs);
  }
  assert.deepEqual(waits, [30_000, 120_000, 600_000]);
  assert.equal(attempts, EVENT_REACTION_MAX_ATTEMPTS);
});

test("a dead key costs a handful of requests, not one every thirty seconds", () => {
  // An hour of failures used to be about 120 requests for one event.
  let attempts = 0;
  let requests = 0;
  let elapsed = 0;
  while (elapsed < 60 * 60 * 1000) {
    requests += 1;
    const next = eventReactionAfterFailure(attempts);
    attempts = next.attempts;
    if (next.giveUp) break;
    elapsed += next.retryAfterMs;
  }
  assert.equal(requests, EVENT_REACTION_MAX_ATTEMPTS);
});

test("attempts that are missing or junk count from zero", () => {
  assert.deepEqual(eventReactionAfterFailure(undefined), { attempts: 1, giveUp: false, retryAfterMs: 30_000 });
  assert.deepEqual(eventReactionAfterFailure("x"), { attempts: 1, giveUp: false, retryAfterMs: 30_000 });
  assert.equal(eventReactionAfterFailure(99).giveUp, true);
});

test("on the last attempt an invited government with its context speaks instead", () => {
  const known = new Set(["France", "Germany"]);
  const hasContext = (name) => known.has(name);
  assert.equal(reactionSpeakerWithContext("France", ["Germany"], hasContext), "France");
  assert.equal(reactionSpeakerWithContext("Atlantis", ["Atlantis", "Germany"], hasContext), "Germany");
});

test("with no invited government that has its context, the reaction is silence", () => {
  assert.equal(reactionSpeakerWithContext("Atlantis", ["Atlantis", "Lemuria"], () => false), "");
  assert.equal(reactionSpeakerWithContext("Atlantis", null, () => false), "");
});
