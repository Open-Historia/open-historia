/*! Open Historia — what the open AI request is doing: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/requestActivity.test.js
//
// Runs without node_modules: requestActivity.js imports nothing.
//
// The invariants: the row can always say which of three things an open request
// is doing; it says nothing when no request is open; it hears a change of what
// it shows and never each chunk; and a request the call has moved on from is
// never left showing.

import test from "node:test";
import assert from "node:assert/strict";

import {
    REQUEST_STATE,
    STILL_WORKING_AFTER_MS,
    createRequestActivity,
    describeCancelPoint,
    describeOpenRequest,
    formatElapsed,
    requestActivity,
} from "./requestActivity.js";

const clock = () => {
    let at = 1000;
    return { now: () => at, advance: (ms) => { at += ms; } };
};

const follow = (activity) => {
    const heard = [];
    activity.subscribe(() => heard.push(activity.current()?.state ?? "none"));
    return heard;
};

test("nothing is open until a request goes out, and nothing once it is over", () => {
    const activity = createRequestActivity({ now: clock().now });
    assert.equal(activity.current(), null);
    const call = activity.track({ label: 'task "jumpForward"' });
    assert.equal(activity.current(), null, "tracking a call opens nothing: the skip may still be reading the world");
    call.sent();
    assert.equal(activity.current().state, REQUEST_STATE.waiting);
    assert.equal(activity.current().label, 'task "jumpForward"');
    call.done();
    assert.equal(activity.current(), null);
    call.done();
    assert.equal(activity.current(), null, "done twice is harmless");
});

test("a request passes from waiting to thinking to writing, by what last arrived", () => {
    const time = clock();
    const activity = createRequestActivity({ now: time.now });
    const call = activity.track({ label: 'task "jumpForward"' });
    call.sent();
    time.advance(40000);
    assert.deepEqual(
        [activity.current().state, activity.current().openMs, activity.current().reasoningChars, activity.current().answerChars],
        ["waiting", 40000, 0, 0],
    );
    call.received({ reasoning: 120 });
    call.received({ reasoning: 80 });
    assert.deepEqual([activity.current().state, activity.current().reasoningChars], ["thinking", 200]);
    call.received({ answer: 15 });
    assert.deepEqual([activity.current().state, activity.current().answerChars, activity.current().reasoningChars], ["writing", 15, 200]);
    // A model that thinks again between two pieces of its answer.
    call.received({ reasoning: 30 });
    assert.equal(activity.current().state, "thinking");
    // Both in one frame: the answer has started.
    call.received({ reasoning: 5, answer: 5 });
    assert.equal(activity.current().state, "writing");
});

test("a frame that carried nothing changes nothing: a keep-alive is not an answer", () => {
    const activity = createRequestActivity({ now: clock().now });
    const heard = follow(activity);
    const call = activity.track();
    call.sent();
    for (const empty of [{}, { reasoning: 0, answer: 0 }, { reasoning: -4 }, { answer: "none" }, { answer: NaN }, undefined]) call.received(empty);
    assert.equal(activity.current().state, "waiting");
    assert.deepEqual(heard, ["waiting"]);
});

test("after a minute open the row is told to say that a slow model can take several", () => {
    const time = clock();
    const activity = createRequestActivity({ now: time.now });
    const call = activity.track();
    call.sent();
    time.advance(STILL_WORKING_AFTER_MS - 1);
    assert.equal(activity.current().stillWorking, false);
    time.advance(1);
    assert.equal(activity.current().stillWorking, true);
    assert.equal(STILL_WORKING_AFTER_MS, 60000);
    // It is the REQUEST that has been open a minute, not the call: the next
    // request of the same call starts its own.
    call.sent();
    assert.equal(activity.current().stillWorking, false);
    assert.equal(activity.current().openMs, 0);
});

test("listeners hear a change in what is shown, never each chunk", () => {
    const activity = createRequestActivity({ now: clock().now });
    const heard = follow(activity);
    const call = activity.track();
    call.sent();
    for (let chunk = 0; chunk < 500; chunk += 1) call.received({ reasoning: 12 });
    for (let chunk = 0; chunk < 2000; chunk += 1) call.received({ answer: 9 });
    call.done();
    assert.deepEqual(heard, ["waiting", "thinking", "writing", "none"], "four renders for 2,500 chunks");
    assert.equal(activity.current(), null);
});

test("a call's next request replaces its last: a lookup round, a retry, the next Fallback entry", () => {
    const time = clock();
    const activity = createRequestActivity({ now: time.now });
    const call = activity.track({ label: 'task "projects"' });
    call.sent();
    call.received({ answer: 300 });
    time.advance(2000);
    call.sent();
    const snapshot = activity.current();
    assert.deepEqual([snapshot.state, snapshot.answerChars, snapshot.openMs, snapshot.openRequests], ["waiting", 0, 0, 1],
        "the first is not left showing as still writing");
});

test("with several open, the one that last received something is shown", () => {
    const time = clock();
    const activity = createRequestActivity({ now: time.now });
    const units = activity.track({ label: 'task "unitDirector"' });
    const ground = activity.track({ label: 'task "territoryDirector"' });
    units.sent();
    time.advance(1000);
    ground.sent();
    assert.equal(activity.current().label, 'task "unitDirector"', "neither has received anything: the one that has waited longest");
    assert.equal(activity.current().openRequests, 2);
    time.advance(1000);
    ground.received({ reasoning: 40 });
    assert.deepEqual([activity.current().label, activity.current().state], ['task "territoryDirector"', "thinking"]);
    time.advance(1000);
    units.received({ answer: 10 });
    assert.deepEqual([activity.current().label, activity.current().state], ['task "unitDirector"', "writing"]);
    units.done();
    assert.deepEqual([activity.current().label, activity.current().state], ['task "territoryDirector"', "thinking"]);
    ground.done();
    assert.equal(activity.current(), null);
});

test("what arrives for a call with nothing open is dropped, not shown", () => {
    const activity = createRequestActivity({ now: clock().now });
    const heard = follow(activity);
    const call = activity.track();
    call.received({ answer: 10 });
    call.sent();
    call.done();
    call.received({ answer: 10 });
    assert.equal(activity.current(), null);
    assert.deepEqual(heard, ["waiting", "none"]);
});

test("a listener that throws costs nothing, and an unsubscribed one hears nothing", () => {
    const activity = createRequestActivity({ now: clock().now });
    let heard = 0;
    activity.subscribe(() => { throw new Error("the row exploded"); });
    const unsubscribe = activity.subscribe(() => { heard += 1; });
    const call = activity.track();
    call.sent();
    assert.equal(heard, 1);
    unsubscribe();
    call.received({ answer: 1 });
    call.done();
    assert.equal(heard, 1);
    assert.equal(activity.current(), null);
});

test("the log line for a cancelled turn says how long the open request had run and what had come back", () => {
    const time = clock();
    const activity = createRequestActivity({ now: time.now });
    assert.equal(describeOpenRequest(activity.current()), "no request was open");
    const call = activity.track({ label: 'task "jumpForward"' });
    call.sent();
    time.advance(106000);
    assert.equal(describeOpenRequest(activity.current()), 'the open request (task "jumpForward") had run 106 s and had received nothing yet');
    call.received({ reasoning: 5120 });
    assert.equal(
        describeOpenRequest(activity.current()),
        'the open request (task "jumpForward") had run 106 s and had received no answer text yet (the model was thinking: 5,120 characters of reasoning)',
    );
    call.received({ answer: 2310 });
    assert.equal(
        describeOpenRequest(activity.current()),
        'the open request (task "jumpForward") had run 106 s and had received 2,310 characters of its answer, after 5,120 of reasoning',
    );
    // A model that does not think out loud, and a call nobody named.
    const plain = createRequestActivity({ now: time.now });
    const other = plain.track();
    other.sent();
    other.received({ answer: 40 });
    assert.equal(describeOpenRequest(plain.current()), "the open request had run 0 s and had received 40 characters of its answer");
});

test("a call that was given no label is named by its task, as the request log names it", () => {
    const activity = createRequestActivity({ now: clock().now });
    const byTask = activity.track({ taskKey: "jumpForward" });
    byTask.sent();
    assert.equal(activity.current().label, 'task "jumpForward"');
    byTask.done();
    const labelled = activity.track({ label: "advisor reply", taskKey: "advisorChat" });
    labelled.sent();
    assert.equal(activity.current().label, "advisor reply", "its own label comes first");
    labelled.done();
    const unnamed = activity.track({});
    unnamed.sent();
    assert.equal(activity.current().label, "");
});

test("a cancelled turn's line ends with how far in the cancel came, and with the request only when one was read", () => {
    const time = clock();
    const activity = createRequestActivity({ now: time.now });
    const call = activity.track({ taskKey: "jumpForward" });
    call.sent();
    time.advance(213400);
    call.received({ reasoning: 18240 });
    // Cancel pressed with a request open: the skip had run a little longer than
    // its request (it read the world first).
    assert.equal(
        `Turn cancelled by the player${describeCancelPoint(215000, activity.current())}.`,
        'Turn cancelled by the player after 215 s; the open request (task "jumpForward") had run 213 s and had received no answer text yet '
            + "(the model was thinking: 18,240 characters of reasoning).",
    );
    // Pressed between two requests, while the skip was doing its own work.
    call.done();
    assert.equal(describeCancelPoint(11200, activity.current()), " after 11 s; no request was open");
    // Stopped some other way than Cancel: nobody read the request, so the line
    // does not claim to know.
    assert.equal(describeCancelPoint(64000, undefined), " after 64 s");
    assert.equal(describeCancelPoint(64000), " after 64 s");
    for (const odd of [-1, NaN, undefined, null]) assert.equal(describeCancelPoint(odd), " after 0 s");
});

test("the skip's clock reads in minutes and seconds", () => {
    assert.equal(formatElapsed(0), "0:00");
    assert.equal(formatElapsed(7400), "0:07");
    assert.equal(formatElapsed(59999), "0:59");
    assert.equal(formatElapsed(106000), "1:46");
    assert.equal(formatElapsed(658000), "10:58");
    assert.equal(formatElapsed(3663000), "61:03", "an hour is sixty-one minutes here: the row has no room for a third field");
    for (const odd of [-5000, NaN, undefined, null, "soon"]) assert.equal(formatElapsed(odd), "0:00");
});

test("the game's own tracker starts with nothing open", () => {
    assert.equal(requestActivity.current(), null);
});
