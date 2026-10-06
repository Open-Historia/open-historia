import assert from "node:assert/strict";
import test from "node:test";
import {
  beginAiRequestScope,
  cancelAllAiRequests,
  getActiveAiRequestCount,
  isCancelAllAbort,
} from "./aiRequestControl.js";
import { createMemoryStateStore, runWithFallback } from "./fallbackRunner.js";
import { asUnreachable } from "./providerErrors.js";

test("cancel all aborts every active AI scope and a later request starts clean", () => {
  const first = beginAiRequestScope();
  const second = beginAiRequestScope();
  assert.equal(getActiveAiRequestCount(), 2);
  assert.equal(first.signal.aborted, false);
  assert.equal(second.signal.aborted, false);

  assert.equal(cancelAllAiRequests(), 2);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
  assert.equal(first.signal.reason?.name, "AbortError");
  assert.equal(second.signal.reason?.name, "AbortError");

  first.finish();
  second.finish();
  assert.equal(getActiveAiRequestCount(), 0);

  const next = beginAiRequestScope();
  assert.equal(next.signal.aborted, false, "new calls must not inherit the cancelled generation");
  next.finish();
});

test("a caller's existing AbortSignal still cancels its composed AI scope", () => {
  const local = new AbortController();
  const scope = beginAiRequestScope(local.signal);
  local.abort(new DOMException("Local cancel", "AbortError"));
  assert.equal(scope.signal.aborted, true);
  assert.equal(scope.signal.reason?.name, "AbortError");
  scope.finish();
  assert.equal(getActiveAiRequestCount(), 0);
});

// The stop reaches a request through callAI's own scope and not through the
// signal its caller handed down, so whoever catches the aborted call has to be
// able to tell that it was the player's stop (gameplay.js runJsonTask: a time
// skip must not write its canned turn over it).
test("the emergency stop's abort can be told from every other abort", () => {
  const plain = beginAiRequestScope();
  const local = new AbortController();
  const composed = beginAiRequestScope(local.signal);
  cancelAllAiRequests();
  assert.equal(isCancelAllAbort(plain.signal.reason), true);
  assert.equal(isCancelAllAbort(composed.signal.reason), true, "through a scope joined to a caller's signal too");
  assert.equal(composed.signal.reason, plain.signal.reason, "one press, one reason");
  plain.finish();
  composed.finish();

  // The caller's own Cancel, a timeout, and anything else merely named AbortError.
  const own = new AbortController();
  const scope = beginAiRequestScope(own.signal);
  own.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
  assert.equal(isCancelAllAbort(scope.signal.reason), false);
  scope.finish();
  assert.equal(isCancelAllAbort(new DOMException("Cancelled by player.", "AbortError")), false, "by identity, not by name or wording");
  assert.equal(isCancelAllAbort(new Error("AI task timed out")), false);
  assert.equal(isCancelAllAbort(null), false);
  assert.equal(isCancelAllAbort("AbortError"), false);
});

test("the stop comes back up through the Fallback list as itself, and is never a reason to try the next model", async () => {
  // The path a stopped call takes out of callAI: the provider call rejects with
  // the signal's reason, asUnreachable looks at it, the list decides.
  const scope = beginAiRequestScope();
  const tried = [];
  const call = runWithFallback({
    entries: [{ id: "first", provider: "openai-compatible", label: "first" }, { id: "backup", provider: "gemini", label: "backup" }],
    store: createMemoryStateStore(),
    attempt: async (entry) => {
      tried.push(entry.id);
      try {
        return await new Promise((resolve, reject) => {
          scope.signal.addEventListener("abort", () => reject(scope.signal.reason), { once: true });
        });
      } catch (error) {
        throw asUnreachable(error, scope.signal);
      }
    },
  }).then(() => null, (error) => error);
  cancelAllAiRequests();
  const error = await call;
  scope.finish();
  assert.equal(isCancelAllAbort(error), true, "the same object, so the task runner can tell");
  assert.equal(error.name, "AbortError");
  assert.equal(error.providerFailure, undefined);
  assert.deepEqual(tried, ["first"], "the backup is not asked: that would be a request after the player stopped them all");
});

test("every press of the stop is announced with its count, a scope opening or closing is not", () => {
  const heard = [];
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.window = { dispatchEvent: (event) => { heard.push(event.detail); return true; } };
  try {
    const scope = beginAiRequestScope();
    cancelAllAiRequests();
    scope.finish();
    cancelAllAiRequests();
  } finally {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  }
  // The Timeline cancels its skip on the announcements that carry `cancelled`
  // (GameUI/time.jsx), and must not on the others.
  assert.deepEqual(heard.map((detail) => "cancelled" in detail), [false, true, false, true]);
  assert.deepEqual(heard.filter((detail) => "cancelled" in detail).map((detail) => detail.cancelled), [1, 0]);
});

test("finishing a scope is idempotent", () => {
  const scope = beginAiRequestScope();
  assert.equal(getActiveAiRequestCount(), 1);
  scope.finish();
  scope.finish();
  assert.equal(getActiveAiRequestCount(), 0);
});
