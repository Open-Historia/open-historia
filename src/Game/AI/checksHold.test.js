/*! Open Historia — a turn held on a failed check: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/checksHold.test.js
//
// Read as source, like turnOrdering.test.js: gameplay.js and time.jsx cannot be
// imported without the whole app. What is pinned is ORDER and ROUTING, which is
// where both bugs lived — a turn written before a failed check was noticed, and
// a restore point counted before it was saved. turnChecks.test.js pins what the
// checks themselves do.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const time = fs.readFileSync(new URL("../GameUI/time.jsx", import.meta.url), "utf8");

const body = (source, start) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `${start} not found`);
    const ends = ["\nexport const ", "\nconst "]
        .map((marker) => source.indexOf(marker, from + start.length))
        .filter((index) => index > from);
    return source.slice(from, ends.length ? Math.min(...ends) : undefined);
};

test("a failed turn review holds the turn before anything is applied", () => {
    const finish = body(gameplay, "const finishTimelineJump = async");
    const review = finish.indexOf('checks.run("review", () => runTurnReview(');
    const hold = finish.indexOf("setPendingChecksJump(");
    const thrown = finish.indexOf("throw checksHeldError(");
    const applied = finish.indexOf("applySimulationResult(");
    assert.ok(review > -1 && hold > review, "the hold follows the review");
    assert.ok(thrown > hold, "the turn is held before the error is thrown");
    assert.ok(applied > thrown, "nothing is applied until the review is settled");
});

test("with Save AI requests off, every separate check goes through the turn's checks", () => {
    const finish = body(gameplay, "const finishTimelineJump = async");
    assert.match(finish, /checks\.run\(\s*"actions"/);
    assert.match(finish, /directorAnalyzers\(\{[\s\S]*?checks,/);
    assert.match(finish, /applyArgs\.projects = \{[^}]*checks \}/);
    const directors = body(gameplay, "const directorAnalyzers = ");
    for (const key of ["units", "territory", "structures"]) {
        assert.match(directors, new RegExp(`askAsCheck\\("${key}", `), `${key} is a check`);
    }
    const apply = body(gameplay, "const applySimulationResult = async");
    assert.match(apply, /checks\.run\(`timeline#\$\{curatorCalls\+\+\}`, ask, fellBack\)/);
});

test("a failed check made inside the apply holds the turn at the last point before the write", () => {
    const apply = body(gameplay, "const applySimulationResult = async");
    const hold = apply.indexOf("if (checksHoldTurn(checks))");
    const write = apply.indexOf("await writeCanonicalTurnState(");
    assert.ok(hold > -1 && write > hold, "held before the write");
    const finish = body(gameplay, "const finishTimelineJump = async");
    assert.match(finish, /if \(error\?\.checksHeld\) setPendingChecksJump\(\{ context, state \}\)/);
});

test("Continue accepts the failed checks; Retry keeps the answers that came back", () => {
    const retry = body(gameplay, "export const retryPendingChecksJump = async");
    assert.match(retry, /setPendingChecksJump\(null\)[\s\S]*finishTimelineJump\(/, "released before the attempt, so a turn is never applied twice");
    assert.match(retry, /if \(withoutFailedChecks\) state\.checks\?\.accept\(\)/);
});

test("a new time skip abandons a turn held on a check", () => {
    assert.match(body(gameplay, "export const simulateTimelineJump = async"), /discardPendingChecksJump\(\)/);
});

test("the timeline shows a held turn with retry, continue and discard", () => {
    assert.match(time, /jumpError\?\.checksHeld/);
    assert.match(time, /retryPendingChecksJump\(\{ signal: controller\.signal, onProgress: showSkipPhase, withoutFailedChecks \}\)/);
    assert.match(time, /Retry the checks/);
    assert.match(time, /Continue without them/);
    assert.match(time, /onClick=\{onDiscardChecks\}/);
});
