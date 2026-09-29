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
    const hold = finish.indexOf("holdTurn(HELD_TURN.checks, { context, state })");
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
    assert.match(apply, /checks\.run\("timeline", ask, fellBack, \{ about: JSON\.stringify\(input\.candidates\) \}\)/);
    assert.match(apply, /checks\.run\("breadth", searchBreadth, \(answer\) => \(answer\?\.failed \?/);
});

test("a failed check made inside the apply holds the turn at the last point before the write", () => {
    const apply = body(gameplay, "const applySimulationResult = async");
    const hold = apply.indexOf("if (checksHoldTurn(checks))");
    const write = apply.indexOf("await writeCanonicalTurnState(");
    assert.ok(hold > -1 && write > hold, "held before the write");
    const finish = body(gameplay, "const finishTimelineJump = async");
    assert.match(finish, /if \(error\?\.heldKind === HELD_TURN\.checks\) holdTurn\(HELD_TURN\.checks, \{ context, state \}\)/);
});

test("Continue accepts the failed checks; Retry keeps the answers that came back", () => {
    const retry = body(gameplay, "export const retryPendingChecksJump = async");
    assert.match(retry, /attemptHeldTurn\(HELD_TURN\.checks, held, \(\) => finishTimelineJump\(/, "released for the attempt, so a turn is never applied twice");
    assert.match(retry, /if \(withoutFailedChecks\) state\.checks\?\.accept\(\)/);
});

test("a new time skip abandons a turn held on a check", () => {
    assert.match(body(gameplay, "export const simulateTimelineJump = async"), /discardHeldTurns\(\)/);
});

test("the timeline shows a held turn with retry, continue and discard", () => {
    assert.match(time, /jumpError\?\.heldKind/);
    assert.match(time, /retryPendingChecksJump\(\{ \.\.\.options, withoutFailedChecks \}\)/);
    assert.match(time, /Retry the checks/);
    assert.match(time, /Continue without them/);
    assert.match(time, /onClick=\{onDiscard\}/);
});

test("the checks' held error names the kind the registry holds it under", async () => {
    // turnChecks.js is import-free, so it spells the kind out; this keeps the
    // two from drifting apart.
    const { HELD_TURN } = await import("./simulationStatus.js");
    const { checksHeldError } = await import("./turnChecks.js");
    assert.equal(checksHeldError([]).heldKind, HELD_TURN.checks);
});

test("a held turn of any kind keeps the idle pulse from writing, until discarded", async () => {
    const { HELD_TURN, discardHeldTurns, holdTurn, isSimulationBusy, getHeldTurn } = await import("./simulationStatus.js");
    for (const kind of Object.values(HELD_TURN)) {
        holdTurn(kind, { held: kind });
        assert.equal(isSimulationBusy(), true);
        assert.deepEqual(getHeldTurn(kind), { held: kind });
        discardHeldTurns();
        assert.equal(isSimulationBusy(), false);
        assert.equal(getHeldTurn(kind), null);
    }
});

// ---- A cancelled retry ----------------------------------------------------------
// The notice stays up after a Cancel, so the turn has to be behind it still.

test("every retry releases its turn through attemptHeldTurn", () => {
    for (const [name, kind] of [["retryPendingJumpSegment", "segment"], ["retryPendingProjectsJump", "board"], ["retryPendingChecksJump", "checks"]]) {
        assert.ok(body(gameplay, `export const ${name} = async`).includes(`attemptHeldTurn(HELD_TURN.${kind}, `), name);
    }
});

test("a cancelled retry puts the held turn back", async () => {
    const { HELD_TURN, attemptHeldTurn, discardHeldTurns, getHeldTurn, holdTurn } = await import("./simulationStatus.js");
    const held = { context: "c", state: "s" };
    holdTurn(HELD_TURN.checks, held);
    const controller = new AbortController();
    let cancelled = false;
    await assert.rejects(attemptHeldTurn(HELD_TURN.checks, held, async () => {
        assert.equal(getHeldTurn(HELD_TURN.checks), null, "released during the attempt");
        controller.abort();
        throw new DOMException("cancelled", "AbortError");
    }, { signal: controller.signal, onCancel: () => { cancelled = true; } }));
    assert.equal(getHeldTurn(HELD_TURN.checks), held);
    assert.equal(cancelled, true);
    discardHeldTurns();
});

test("a retry held again, or failed outright, is not put back as it was", async () => {
    const { HELD_TURN, attemptHeldTurn, discardHeldTurns, getHeldTurn, holdTurn } = await import("./simulationStatus.js");
    const held = { state: "old" };
    holdTurn(HELD_TURN.checks, held);
    await assert.rejects(attemptHeldTurn(HELD_TURN.checks, held, async () => {
        holdTurn(HELD_TURN.checks, { state: "new" });
        throw Object.assign(new Error("held again"), { heldKind: HELD_TURN.checks });
    }));
    assert.deepEqual(getHeldTurn(HELD_TURN.checks), { state: "new" });
    holdTurn(HELD_TURN.checks, held);
    await assert.rejects(attemptHeldTurn(HELD_TURN.checks, held, async () => { throw new Error("the write failed"); }));
    assert.equal(getHeldTurn(HELD_TURN.checks), null);
    discardHeldTurns();
});

// ---- A board hold and a failed check ----------------------------------------------

test("a failed check holds the turn before the board is asked", () => {
    const apply = body(gameplay, "const applySimulationResult = async");
    const hold = apply.indexOf("if (checksHoldTurn(checks))");
    const board = apply.indexOf('phases?.enter("board")');
    assert.ok(hold > -1 && board > hold, "held before the board, so the board cannot hold the turn over a failed check");
});

test("a board retry that a check then holds hands the turn to the checks", () => {
    const finish = body(gameplay, "const finishTimelineJump = async");
    assert.match(finish, /holdTurn\(HELD_TURN\.board, \{ applyArgs, context, state \}\)/);
    const retry = body(gameplay, "export const retryPendingProjectsJump = async");
    assert.match(retry, /error\?\.heldKind === HELD_TURN\.checks && heldProjectsJump\.context[\s\S]*holdTurn\(HELD_TURN\.checks, \{ context: heldProjectsJump\.context, state: heldProjectsJump\.state \}\)/);
});

test("a canned turn's checks never hold it: the fallback page and its Rollback do instead", () => {
    const finish = body(gameplay, "const finishTimelineJump = async");
    const created = finish.indexOf("createTurnChecks()");
    const accepted = finish.indexOf('=== "fallback") checks.accept();');
    const firstHold = finish.indexOf("checksHoldTurn(checks)");
    assert.ok(created > -1 && accepted > created && firstHold > accepted);
});
