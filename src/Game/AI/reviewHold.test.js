/*! Open Historia — a turn held on its review, and the restore point it leaves: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/reviewHold.test.js
//
// Read as source, like turnOrdering.test.js: gameplay.js and time.jsx cannot be
// imported without the whole app. What is pinned is ORDER, which is where both
// bugs lived — a turn written before its review was known to have failed, and
// a restore point counted before it was saved.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const time = fs.readFileSync(new URL("../GameUI/time.jsx", import.meta.url), "utf8");

const body = (source, start) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `${start} not found`);
    const next = source.indexOf("\nexport const ", from + start.length);
    const nextLocal = source.indexOf("\nconst ", from + start.length);
    const ends = [next, nextLocal].filter((index) => index > from);
    return source.slice(from, ends.length ? Math.min(...ends) : undefined);
};

test("a failed review holds the turn BEFORE anything is applied or written", () => {
    const finish = body(gameplay, "const finishTimelineJump = async");
    const review = finish.indexOf("runTurnReview(");
    const hold = finish.indexOf("setPendingReviewJump(");
    const thrown = finish.indexOf("throw reviewHeldError(");
    const applied = finish.indexOf("applySimulationResult(");
    assert.ok(review > -1 && hold > review, "the hold follows the review");
    assert.ok(thrown > hold, "the turn is held before the error is thrown");
    assert.ok(applied > thrown, "nothing is applied until the review is settled");
});

test("a review the player chose to go without is not asked again, nor held on", () => {
    const finish = body(gameplay, "const finishTimelineJump = async");
    assert.match(finish, /state\.acceptedReview \?\? await runTurnReview\(/);
    assert.match(finish, /review !== state\.acceptedReview && reviewNeedsRetry\(review\)/);
    const retry = body(gameplay, "export const retryPendingReviewJump = async");
    assert.match(retry, /setPendingReviewJump\(null\)[\s\S]*finishTimelineJump\(/, "released before the attempt, so a turn is never applied twice");
    assert.match(retry, /state\.acceptedReview = withoutReview \? review : null/);
});

test("a new time skip abandons a turn held on its review", () => {
    const start = body(gameplay, "export const simulateTimelineJump = async");
    assert.match(start, /discardPendingReviewJump\(\)/);
});

test("the timeline shows a held review with retry, continue and discard", () => {
    assert.match(time, /jumpError\?\.reviewHeld/);
    assert.match(time, /retryPendingReviewJump\(\{ signal: controller\.signal, onProgress: showSkipPhase, withoutReview \}\)/);
    assert.match(time, /Retry the checks/);
    assert.match(time, /Continue without them/);
    assert.match(time, /onClick=\{onDiscardReview\}/);
});
