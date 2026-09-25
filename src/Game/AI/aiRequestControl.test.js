import assert from "node:assert/strict";
import test from "node:test";
import {
  beginAiRequestScope,
  cancelAllAiRequests,
  getActiveAiRequestCount,
} from "./aiRequestControl.js";

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

test("finishing a scope is idempotent", () => {
  const scope = beginAiRequestScope();
  assert.equal(getActiveAiRequestCount(), 1);
  scope.finish();
  scope.finish();
  assert.equal(getActiveAiRequestCount(), 0);
});
