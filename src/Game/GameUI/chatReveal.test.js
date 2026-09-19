/*! Open Historia — group turn reveal tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/chatReveal.test.js
//
// Runs without node_modules: chatReveal.js imports nothing.
//
// The invariant: a group turn is said a step at a time, each after its speaker
// has been seen typing for the pause; cutting in or leaving stops it where it
// stands and hands back exactly what was not said; a step that cannot be said
// ends the turn; and each step is written onto the thread as it stands, never
// over a vote cast in between.

import test from "node:test";
import assert from "node:assert/strict";

import { logForNextStep, startChatReveal } from "./chatReveal.js";

// A clock the test moves by hand.
const handClock = () => {
    let now = 0;
    const timers = [];
    return {
        schedule: (fn, ms) => { const timer = { at: now + ms, fn }; timers.push(timer); return timer; },
        cancel: (timer) => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
        advance: (ms) => {
            now += ms;
            for (;;) {
                timers.sort((a, b) => a.at - b.at);
                const due = timers[0];
                if (!due || due.at > now) break;
                timers.shift();
                due.fn();
            }
        },
        pending: () => timers.length,
    };
};

const step = (speaker, id) => ({ speaker, events: [{ id, kind: "message", by: speaker }] });

const record = (steps, { onSay } = {}) => {
    const clock = handClock();
    const log = [];
    const reveal = startChatReveal({
        steps,
        pauseMs: 5000,
        onTyping: (next) => log.push(next ? `typing ${next.speaker}` : "nobody typing"),
        onSay: (said) => { log.push(`said ${said.events[0].id}`); return onSay ? onSay(said) : true; },
        onEnd: () => log.push("end"),
        schedule: clock.schedule,
        cancel: clock.cancel,
    });
    return { clock, log, reveal };
};

test("each step is said after its speaker has typed for the pause", () => {
    const { clock, log, reveal } = record([step("Prussia", "b"), step("France", "c")]);
    assert.deepEqual(log, ["typing Prussia"]);
    clock.advance(4999);
    assert.deepEqual(log, ["typing Prussia"], "not a moment early");
    clock.advance(1);
    assert.deepEqual(log, ["typing Prussia", "said b", "typing France"]);
    clock.advance(5000);
    assert.deepEqual(log, ["typing Prussia", "said b", "typing France", "said c", "nobody typing", "end"]);
    assert.equal(reveal.running, false);
    assert.deepEqual(reveal.stop(), [], "nothing left once it has all been said");
});

test("cutting in stops the turn where it stands and hands back what was not said", () => {
    const later = [step("Prussia", "b"), step("France", "c"), step("Prussia", "d")];
    const { clock, log, reveal } = record(later);
    clock.advance(5000);
    const rest = reveal.stop();
    assert.deepEqual(rest.map((entry) => entry.events[0].id), ["c", "d"]);
    assert.deepEqual(log.slice(-2), ["nobody typing", "end"]);
    clock.advance(60000);
    assert.equal(log.includes("said c"), false, "a step handed back is never said");
    assert.equal(clock.pending(), 0);
    assert.deepEqual(reveal.stop(), [], "stopping twice hands back nothing more");
});

test("a step that cannot be said ends the turn, and nothing after it is said", () => {
    const { clock, log, reveal } = record([step("Prussia", "b"), step("France", "c")], { onSay: () => false });
    clock.advance(5000);
    clock.advance(5000);
    assert.deepEqual(log, ["typing Prussia", "said b", "nobody typing", "end"]);
    assert.equal(reveal.running, false);
});

test("a turn with nothing held ends at once", () => {
    const { log, reveal } = record([]);
    assert.deepEqual(log, ["nobody typing", "end"]);
    assert.equal(reveal.running, false);
});

test("a step is written onto the thread as it stands, never over a vote cast in between", () => {
    const turnLog = [{ id: "m1" }, { id: "you" }, { id: "b" }];
    const withVote = [{ id: "m1" }, { id: "you" }, { id: "b" }, { id: "vote-p-Bavaria" }];
    assert.equal(logForNextStep({ turnLog, wroteAny: true, chatId: 7, liveChatId: "7", liveLog: withVote }), withVote, "the live thread, vote and all");
    assert.equal(logForNextStep({ turnLog, wroteAny: false, chatId: 7, liveChatId: 7, liveLog: withVote }), turnLog, "the first step takes the turn's copy, with the player's line");
    assert.equal(logForNextStep({ turnLog, wroteAny: true, chatId: 7, liveChatId: 7, liveLog: [{ id: "m1" }] }), turnLog, "a live copy that has not caught up is not written over");
    assert.equal(logForNextStep({ turnLog, wroteAny: true, chatId: 7, liveChatId: 8, liveLog: withVote }), turnLog, "another thread's log is never used");
    assert.equal(logForNextStep({ turnLog, wroteAny: true, chatId: 7, liveChatId: 7, liveLog: null }), turnLog);
});
