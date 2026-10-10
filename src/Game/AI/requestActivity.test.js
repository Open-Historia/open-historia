/*! Open Historia — open-request activity tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/requestActivity.test.js
//
// Runs without node_modules: requestActivity.js imports nothing.
//
// The invariants: a request reads as waiting until something of an answer
// arrives, then as whatever its last chunk carried; a minute open is "still
// working"; with several open the one that last received something is shown;
// and nothing is shown once the last one has closed.

import test from "node:test";
import assert from "node:assert/strict";

import {
  REQUEST_THINKING,
  REQUEST_WAITING,
  REQUEST_WRITING,
  STILL_WORKING_AFTER_MS,
  createRequestActivity,
  describeRequestActivity,
  formatElapsedClock,
} from "./requestActivity.js";

const clock = () => {
  let at = 1000;
  return { now: () => at, advance: (ms) => { at += ms; } };
};

test("nothing is open until a request is, and nothing once it has closed", () => {
  const activity = createRequestActivity({ now: clock().now });
  assert.equal(activity.current(), null);
  const request = activity.open({ label: 'task "jumpForward"' });
  assert.equal(activity.current().state, REQUEST_WAITING);
  request.close();
  assert.equal(activity.current(), null);
});

test("a request waits, thinks, then writes, by what its chunks carry", () => {
  const time = clock();
  const activity = createRequestActivity({ now: time.now });
  const request = activity.open({ label: 'task "jumpForward" → the model' });

  time.advance(4000);
  assert.deepEqual(activity.current(), {
    label: 'task "jumpForward" → the model',
    state: REQUEST_WAITING,
    openMs: 4000,
    chunks: 0,
    reasoningChars: 0,
    answerChars: 0,
    stillWorking: false,
  });

  // A keep-alive is life, not an answer.
  request.received({ reasoningChars: 0, answerChars: 0 });
  assert.equal(activity.current().state, REQUEST_WAITING);
  assert.equal(activity.current().chunks, 1);

  request.received({ reasoningChars: 120 });
  request.received({ reasoningChars: 80 });
  assert.equal(activity.current().state, REQUEST_THINKING);
  assert.equal(activity.current().reasoningChars, 200);

  request.received({ answerChars: 40 });
  assert.equal(activity.current().state, REQUEST_WRITING);
  assert.equal(activity.current().answerChars, 40);
  assert.equal(activity.current().chunks, 4);

  // A model that goes back to thinking between two tool calls is thinking again.
  request.received({ reasoningChars: 10 });
  assert.equal(activity.current().state, REQUEST_THINKING);
});

test("a chunk with reasoning and answer text is the model starting to write", () => {
  const activity = createRequestActivity({ now: clock().now });
  const request = activity.open();
  request.received({ reasoningChars: 30, answerChars: 5 });
  assert.equal(activity.current().state, REQUEST_WRITING);
});

test("a minute open is still working, measured from when the request went out", () => {
  const time = clock();
  const activity = createRequestActivity({ now: time.now });
  const request = activity.open();
  time.advance(STILL_WORKING_AFTER_MS - 1);
  assert.equal(activity.current().stillWorking, false);
  time.advance(1);
  assert.equal(activity.current().stillWorking, true);

  // The provider path asks again inside the same call: a new request, a new minute.
  request.received({ reasoningChars: 500 });
  request.sent();
  const again = activity.current();
  assert.equal(again.state, REQUEST_WAITING);
  assert.equal(again.openMs, 0);
  assert.equal(again.reasoningChars, 0);
  assert.equal(again.chunks, 0);
  assert.equal(again.stillWorking, false);
});

test("with several open, the one that last received something is shown", () => {
  const time = clock();
  const activity = createRequestActivity({ now: time.now });
  const first = activity.open({ label: "first" });
  time.advance(10);
  const second = activity.open({ label: "second" });
  // Neither has heard anything: the one that went out last.
  assert.equal(activity.current().label, "second");

  time.advance(10);
  first.received({ reasoningChars: 12 });
  assert.equal(activity.current().label, "first");

  time.advance(10);
  second.received({ answerChars: 3 });
  assert.equal(activity.current().label, "second");

  second.close();
  assert.equal(activity.current().label, "first");
  first.close();
  assert.equal(activity.current(), null);
});

test("listeners hear a request open, go out, change state and close, not every chunk", () => {
  const activity = createRequestActivity({ now: clock().now });
  let heard = 0;
  const stop = activity.subscribe(() => { heard += 1; });
  const request = activity.open();
  assert.equal(heard, 1);
  request.sent();
  assert.equal(heard, 2);
  request.received({});
  request.received({ reasoningChars: 5 });
  assert.equal(heard, 3);
  request.received({ reasoningChars: 5 });
  request.received({ reasoningChars: 5 });
  assert.equal(heard, 3, "more of the same is not news");
  request.received({ answerChars: 5 });
  assert.equal(heard, 4);
  request.close();
  assert.equal(heard, 5);
  request.close();
  assert.equal(heard, 5, "closing twice says it once");

  stop();
  activity.open().close();
  assert.equal(heard, 5);
});

test("a listener that throws, and a report after close, cost nothing", () => {
  const activity = createRequestActivity({ now: clock().now });
  activity.subscribe(() => { throw new Error("the row exploded"); });
  const request = activity.open();
  request.received({ answerChars: 9 });
  request.close();
  request.received({ answerChars: 9 });
  request.sent();
  assert.equal(activity.current(), null);
  assert.equal(typeof activity.subscribe(null), "function");
});

test("bad counts are read as nothing", () => {
  const activity = createRequestActivity({ now: clock().now });
  const request = activity.open();
  request.received({ reasoningChars: -4, answerChars: "many" });
  request.received();
  const shown = activity.current();
  assert.equal(shown.state, REQUEST_WAITING);
  assert.equal(shown.reasoningChars + shown.answerChars, 0);
  assert.equal(shown.chunks, 2);
});

test("the clock reads minutes and seconds", () => {
  assert.equal(formatElapsedClock(0), "0:00");
  assert.equal(formatElapsedClock(7400), "0:07");
  assert.equal(formatElapsedClock(106000), "1:46");
  assert.equal(formatElapsedClock(658300), "10:58");
  assert.equal(formatElapsedClock(75 * 60000 + 3000), "75:03");
  assert.equal(formatElapsedClock(-5), "0:00");
  assert.equal(formatElapsedClock(undefined), "0:00");
});

test("the log clause says how long the request was open and what it had received", () => {
  assert.equal(describeRequestActivity(null), "no request was open");
  const base = { label: 'task "jumpForward" → the model', openMs: 105400, chunks: 0, reasoningChars: 0, answerChars: 0 };
  assert.equal(
    describeRequestActivity(base),
    'the open request (task "jumpForward" → the model, open 105 s) had received nothing yet',
  );
  assert.equal(
    describeRequestActivity({ ...base, chunks: 12 }),
    'the open request (task "jumpForward" → the model, open 105 s) had received no text yet (12 chunks of keep-alives or empty frames)',
  );
  assert.equal(
    describeRequestActivity({ ...base, chunks: 40, reasoningChars: 5210 }),
    'the open request (task "jumpForward" → the model, open 105 s) had received no answer text yet (the model was thinking: 5,210 characters of reasoning)',
  );
  assert.equal(
    describeRequestActivity({ ...base, label: "", chunks: 90, reasoningChars: 5210, answerChars: 1 }),
    "the open request (open 105 s) had received 1 character of its answer after 5,210 characters of reasoning",
  );
  assert.equal(
    describeRequestActivity({ ...base, label: "", answerChars: 3420 }),
    "the open request (open 105 s) had received 3,420 characters of its answer",
  );
});
