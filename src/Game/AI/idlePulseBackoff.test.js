/*! Open Historia — the idle pulse backs off a quiet world: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/idlePulseBackoff.test.js
//
// Each pulse that passes its roll is a background request. A pulse on a world
// nothing has touched since the last empty answer is likely to answer empty
// again, so it is made less likely — never impossible, since the answer is
// sampled — and any change restores the full chance.

import test from "node:test";
import assert from "node:assert/strict";

import { IDLE_PULSE_MAX_BACKOFF, createIdlePulseBackoff, idlePulseFingerprint } from "./idlePulse.js";
import { PLAYER_ACTIVITY_WINDOW_MS, createPlayerActivity } from "../../runtime/playerActivity.js";

const chat = (id, messageIds) => ({ id, messages: messageIds.map((messageId) => ({ id: messageId })) });
const state = (extra = {}) => ({ round: 4, tick: 2, eventCount: 30, chats: [chat("c1", ["m1", "m2"])], ...extra });

test("the fingerprint moves with the round, the pulse's own tick, the events and every open chat", () => {
    const base = idlePulseFingerprint(state());
    assert.equal(idlePulseFingerprint(state()), base);
    assert.notEqual(idlePulseFingerprint(state({ round: 5 })), base);
    assert.notEqual(idlePulseFingerprint(state({ tick: 3 })), base);
    assert.notEqual(idlePulseFingerprint(state({ eventCount: 31 })), base);
    assert.notEqual(idlePulseFingerprint(state({ chats: [chat("c1", ["m1", "m2", "m3"])] })), base);
    assert.notEqual(idlePulseFingerprint(state({ chats: [chat("c1", ["m1", "m2"]), chat("c2", ["x"])] })), base);
    // Chat order is not a change.
    assert.equal(
        idlePulseFingerprint(state({ chats: [chat("a", ["1"]), chat("b", ["2"])] })),
        idlePulseFingerprint(state({ chats: [chat("b", ["2"]), chat("a", ["1"])] })),
    );
});

test("each empty answer on the same world halves the next pulse's chance, down to a floor", () => {
    const backoff = createIdlePulseBackoff();
    const quiet = idlePulseFingerprint(state());
    assert.equal(backoff.share(quiet), 1);
    backoff.note(quiet, true);
    assert.equal(backoff.share(quiet), 0.5);
    backoff.note(quiet, true);
    assert.equal(backoff.share(quiet), 0.25);
    for (let i = 0; i < 10; i += 1) backoff.note(quiet, true);
    assert.equal(backoff.share(quiet), 0.5 ** IDLE_PULSE_MAX_BACKOFF);
    assert.ok(backoff.share(quiet) > 0);
});

test("a changed world, or an answer with something in it, restores the full chance", () => {
    const backoff = createIdlePulseBackoff();
    const quiet = idlePulseFingerprint(state());
    backoff.note(quiet, true);
    backoff.note(quiet, true);
    assert.equal(backoff.share(idlePulseFingerprint(state({ eventCount: 31 }))), 1);
    backoff.note(quiet, false);
    assert.equal(backoff.share(quiet), 1);
});

test("an empty answer on a new world starts the count again", () => {
    const backoff = createIdlePulseBackoff();
    const first = idlePulseFingerprint(state());
    const second = idlePulseFingerprint(state({ round: 5 }));
    backoff.note(first, true);
    backoff.note(first, true);
    backoff.note(second, true);
    assert.equal(backoff.share(second), 0.5);
    assert.equal(backoff.share(first), 1);
});

test("the player counts as present for ten minutes after they last touched the game", () => {
    let clock = 1000;
    const activity = createPlayerActivity({ now: () => clock });
    assert.equal(activity.isPresent(), true);
    clock += PLAYER_ACTIVITY_WINDOW_MS - 1;
    assert.equal(activity.isPresent(), true);
    clock += 1;
    assert.equal(activity.isPresent(), false);
    activity.note();
    assert.equal(activity.isPresent(), true);
});
