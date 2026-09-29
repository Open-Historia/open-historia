/*! Open Historia — the checks a time skip makes after its events: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/turnChecks.test.js
//
// Runs without node_modules: turnChecks.js imports nothing.
//
// What the player is promised when a check fails: the turn waits, Retry asks
// only what failed, and Continue asks nothing. Each of those is a request that
// is or is not made, so the count of asks is what is pinned.

import test from "node:test";
import assert from "node:assert/strict";

import { checksHeldError, checksHoldTurn, createTurnChecks, describeCheck } from "./turnChecks.js";

const fellBack = (answer) => (answer?.generation?.source === "fallback" ? answer.generation.fallbackReason : "");
const ai = (payload) => ({ payload, generation: { source: "ai" } });
const fallback = (reason) => ({ payload: { eventOrders: [] }, generation: { source: "fallback", fallbackReason: reason } });

const counted = (answers) => {
    let calls = 0;
    const ask = async () => answers[Math.min(calls++, answers.length - 1)];
    return { ask, calls: () => calls };
};

test("a check with nothing to change has answered, and holds nothing", async () => {
    const checks = createTurnChecks();
    await checks.run("units", async () => ai({ eventOrders: [] }), fellBack);
    assert.equal(checksHoldTurn(checks), false);
});

test("a check that fell back holds the turn and says why", async () => {
    const checks = createTurnChecks();
    await checks.run("units", async () => fallback("503 The model is overloaded"), fellBack);
    assert.equal(checksHoldTurn(checks), true);
    const error = checksHeldError(checks.failures());
    assert.equal(error.heldKind, "checks");
    assert.match(error.message, /nothing has been saved yet/);
    assert.match(error.message, /unit moves \(503 The model is overloaded\)/);
});

test("a retry asks again only the checks that failed", async () => {
    const checks = createTurnChecks();
    const units = counted([fallback("timeout"), ai({ eventOrders: [{ eventIndex: 0 }] })]);
    const territory = counted([ai({ eventOrders: [] })]);
    const finish = async () => {
        await checks.run("units", units.ask, fellBack);
        await checks.run("territory", territory.ask, fellBack);
    };
    await finish();
    assert.equal(checksHoldTurn(checks), true);
    await finish(); // Retry
    assert.equal(units.calls(), 2);
    assert.equal(territory.calls(), 1, "the check that answered is not asked again");
    assert.equal(checksHoldTurn(checks), false);
});

test("continuing without asks nothing, and gives the failed answer back", async () => {
    const checks = createTurnChecks();
    const units = counted([fallback("timeout")]);
    await checks.run("units", units.ask, fellBack);
    checks.accept();
    const answer = await checks.run("units", units.ask, fellBack);
    assert.equal(units.calls(), 1);
    assert.equal(answer.generation.source, "fallback");
    assert.equal(checksHoldTurn(checks), false);
});

test("a kept answer is a copy, so what the turn does to it cannot change a retry", async () => {
    const checks = createTurnChecks();
    const first = await checks.run("units", async () => ai({ eventOrders: [{ at: "Kyiv" }] }), fellBack);
    first.payload.eventOrders[0].lng = 30.5; // placement resolves `at` in place
    const again = await checks.run("units", async () => assert.fail("asked twice"), fellBack);
    assert.deepEqual(again.payload.eventOrders[0], { at: "Kyiv" });
});

test("a check that threw is not kept: the caller handles it as before", async () => {
    const checks = createTurnChecks();
    await assert.rejects(checks.run("board", async () => { throw new Error("board failed"); }));
    assert.deepEqual(checks.failures(), []);
});

test("checks are named by what they are", () => {
    assert.equal(describeCheck("timeline"), "the timeline clean-up");
    assert.equal(describeCheck("review"), "the turn review");
});

test("a check asked about something else is asked, never handed another answer", async () => {
    const checks = createTurnChecks();
    const curator = counted([ai({ judgments: ["about A"] }), ai({ judgments: ["about B"] })]);
    await checks.run("timeline", curator.ask, fellBack, { about: "events A" });
    const again = await checks.run("timeline", curator.ask, fellBack, { about: "events A" });
    const other = await checks.run("timeline", curator.ask, fellBack, { about: "events B" });
    assert.deepEqual(again.payload.judgments, ["about A"]);
    assert.deepEqual(other.payload.judgments, ["about B"]);
    assert.equal(curator.calls(), 2);
});

test("a cancelled Continue is taken back: the failed checks hold the turn again", async () => {
    const checks = createTurnChecks();
    await checks.run("units", async () => fallback("timeout"), fellBack);
    checks.accept();
    assert.equal(checksHoldTurn(checks), false);
    checks.accept(false);
    assert.equal(checksHoldTurn(checks), true);
});
