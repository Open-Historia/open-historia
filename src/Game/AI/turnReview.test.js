/*! Open Historia — the turn review: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/turnReview.test.js
//
// Runs without node_modules: turnReview.js imports nothing.
//
// Several jobs share one request here, and the two ways that goes wrong are both
// quiet. A rule or an index leaking from one job into the next produces a turn
// that looks fine and is subtly wrong; a board op that lands on the wrong event
// after the timeline changed stamps a project with something that never
// happened. The fences and the renumbering are what prevent those, so both are
// pinned.

import test from "node:test";
import assert from "node:assert/strict";

import {
    TURN_REVIEW_TOOL_NAME,
    buildTurnReviewPrompt,
    buildTurnReviewTool,
    normalizeReviewJobs,
    readTurnReviewAnswer,
    remapBoardOps,
    reviewHeldError,
    reviewNeedsRetry,
    shareRepeatedBlocks,
} from "./turnReview.js";

const objectSchema = (field) => ({ type: "object", properties: { [field]: { type: "array" } }, required: [field] });

const JOBS = [
    { key: "units", title: "Move the units", prompt: "You are the unit director.\nRULES: reuse before spawn.\nReturn the required tool payload only.", instruction: "Advance the military events.", schema: objectSchema("eventOrders") },
    { key: "timeline", title: "Tidy the timeline", prompt: "You are the curator. DEFAULT VERDICT = KEEP.\nReturn JSON only.", instruction: "Judge every candidate.", schema: objectSchema("judgments") },
];

test("a job needs a usable field name, a prompt and a schema; a repeat of a field is ignored", () => {
    const kept = normalizeReviewJobs([
        ...JOBS,
        { key: "units", title: "again", prompt: "x", schema: {} },
        { key: "has space", prompt: "x", schema: {} },
        { key: "9lives", prompt: "x", schema: {} },
        { key: "noPrompt", prompt: "  ", schema: {} },
        { key: "noSchema", prompt: "x" },
        null,
    ]);
    assert.deepEqual(kept.map((job) => job.key), ["units", "timeline"]);
    assert.deepEqual(normalizeReviewJobs(undefined), []);
});

test("every job's own prompt and instruction go out whole, between its own fences", () => {
    const prompt = buildTurnReviewPrompt(JOBS);
    for (const job of JOBS) {
        const begin = prompt.indexOf(`BEGINNING OF JOB "${job.key}"`);
        const end = prompt.indexOf(`END OF JOB "${job.key}"`);
        assert.ok(begin > 0 && end > begin, job.key);
        const inside = prompt.slice(begin, end);
        assert.ok(inside.includes(job.prompt), `${job.key}: prompt`);
        assert.ok(inside.includes(job.instruction), `${job.key}: instruction`);
        assert.ok(inside.includes(`The "${job.key}" field of ${TURN_REVIEW_TOOL_NAME}`), `${job.key}: where the answer goes`);
    }
    // In the order given, and never nested.
    assert.ok(prompt.indexOf('END OF JOB "units"') < prompt.indexOf('BEGINNING OF JOB "timeline"'));
});

test("the preamble says what the jobs' own output lines mean here, and that nothing crosses a fence", () => {
    const prompt = buildTurnReviewPrompt(JOBS);
    const preamble = prompt.slice(0, prompt.indexOf("##########"));
    assert.match(preamble, /2 separate bookkeeping jobs/);
    assert.match(preamble, /never carry an index, a rule or a verdict from one job into another/);
    assert.match(preamble, /describes the CONTENT of its field/);
    assert.match(preamble, /changing nothing is a normal and correct answer/);
    assert.match(preamble, /units \(Move the units\); timeline \(Tidy the timeline\)/);
    assert.match(buildTurnReviewPrompt(JOBS.slice(0, 1)), /one bookkeeping job has to be done/);
    assert.equal(buildTurnReviewPrompt([]), "");
});

test("the same jobs give the same prompt, byte for byte", () => {
    assert.equal(buildTurnReviewPrompt(JOBS), buildTurnReviewPrompt(structuredClone(JOBS)));
});

test("the output function has one required field per job, each with that job's own schema", () => {
    const tool = buildTurnReviewTool(JOBS);
    assert.equal(tool.name, TURN_REVIEW_TOOL_NAME);
    assert.deepEqual(Object.keys(tool.schema.properties), ["units", "timeline"]);
    assert.deepEqual(tool.schema.required, ["units", "timeline"]);
    assert.equal(tool.schema.additionalProperties, false);
    assert.equal(tool.schema.properties.units, JOBS[0].schema);
});

test("the answer is taken apart by field; a missing or wrong-shaped part is simply absent", () => {
    const parts = readTurnReviewAnswer(JOBS, { units: { eventOrders: [] }, timeline: "nothing to say", extra: { a: 1 } });
    assert.deepEqual(parts, { units: { eventOrders: [] }, timeline: undefined });
    assert.deepEqual(readTurnReviewAnswer(JOBS, null), { units: undefined, timeline: undefined });
    assert.deepEqual(readTurnReviewAnswer(JOBS, []), { units: undefined, timeline: undefined });
});

test("a part sent as a JSON string is still that job's answer", () => {
    const parts = readTurnReviewAnswer(JOBS, { units: "{\"eventOrders\":[{\"eventIndex\":0}]}", timeline: "{broken" });
    assert.deepEqual(parts.units, { eventOrders: [{ eventIndex: 0 }] });
    assert.equal(parts.timeline, undefined);
});

// --- Text several jobs share ---

test("a long block two jobs both carry goes out once, and the later job points at it", () => {
    const rules = `SIMULATION RULES. ${"Armies need supply. ".repeat(120)}`;
    const snapshot = `WORLD SNAPSHOT. ${"Russia borders Ukraine. ".repeat(100)}`;
    const jobs = [
        { key: "board", prompt: `You keep the board.\n${rules}\nEnd.` },
        { key: "spy_1", prompt: `You are the desk for Ukraine.\nRules: ${rules}\nWorld: ${snapshot}` },
        { key: "spy_2", prompt: `You are the desk for Poland.\nRules: ${rules}\nWorld: ${snapshot}` },
    ];
    const { jobs: shared, savedChars } = shareRepeatedBlocks(jobs, [snapshot, rules, "short", rules]);
    assert.ok(shared[0].prompt.includes(rules), "the first job keeps its text");
    assert.ok(!shared[1].prompt.includes(rules) && shared[1].prompt.includes(snapshot), "spy_1 keeps the snapshot it is first to carry");
    assert.ok(!shared[2].prompt.includes(rules) && !shared[2].prompt.includes(snapshot));
    assert.match(shared[1].prompt, /\[The same text as in job "board" above — the passage that begins "SIMULATION RULES\. Armies need supply\./);
    assert.match(shared[2].prompt, /\[The same text as in job "spy_1" above — the passage that begins "WORLD SNAPSHOT\./);
    assert.equal(savedChars, jobs.reduce((sum, job) => sum + job.prompt.length, 0) - shared.reduce((sum, job) => sum + job.prompt.length, 0));
    assert.ok(savedChars > rules.length * 2);
    // The caller's jobs are not edited in place.
    assert.ok(jobs[2].prompt.includes(rules));
});

test("text that only looks alike, or is short, or is in one job, is left exactly as it was", () => {
    const block = "A".repeat(2000);
    const jobs = [{ key: "a", prompt: `x ${block} y` }, { key: "b", prompt: `x ${block.slice(1)} y` }];
    const { jobs: shared, savedChars } = shareRepeatedBlocks(jobs, [block, "tiny"]);
    assert.deepEqual(shared.map((job) => job.prompt), jobs.map((job) => job.prompt));
    assert.equal(savedChars, 0);
    assert.deepEqual(shareRepeatedBlocks([], [block]), { jobs: [], savedChars: 0 });
    assert.deepEqual(shareRepeatedBlocks(jobs, undefined).savedChars, 0);
});

// --- The board's event numbers ---

const shown = [
    { id: "seg-a", date: "2014-03-02", title: "Refinery expansion funded" },
    { id: "seg-b", date: "2014-03-05", title: "Routine inspection of the refinery" },
    { id: "seg-c", date: "2014-03-09", title: "Refinery expansion funded again" },
    { id: "seg-h", date: "2014-03-11", title: "Pipeline survey continues" },
];

test("an op follows its event onto the timeline, under the event's permanent id", () => {
    const idMap = new Map([["seg-a", "event-ai-r0007-20140302-001"]]);
    const visible = [{ id: "event-ai-r0007-20140302-001", date: "2014-03-02", title: "Refinery expansion funded" }];
    const { ops, dropped } = remapBoardOps({
        ops: [{ op: "update", id: "p1", eventIndex: 0, progress: 40 }],
        shownEvents: shown, visibleEvents: visible, hiddenEvents: [], idMap,
    });
    assert.deepEqual(ops, [{ op: "update", id: "p1", eventIndex: 0, progress: 40 }]);
    assert.equal(dropped, 0);
});

test("an op whose event was taken off the timeline but still happened rides the Hidden event", () => {
    const visible = [{ id: "new-a", date: "2014-03-02", title: "Refinery expansion funded" }];
    const hidden = [
        { id: "seg-h", date: "2014-03-11", title: "Pipeline survey continues" },
        { id: "seg-b", date: "2014-03-05", title: "Routine inspection of the refinery" },
    ];
    const { ops } = remapBoardOps({
        ops: [{ op: "update", id: "p1", eventIndex: 1 }, { op: "update", id: "p2", eventIndex: 3 }],
        shownEvents: shown, visibleEvents: visible, hiddenEvents: hidden, idMap: new Map([["seg-a", "new-a"]]),
    });
    // Hidden events are numbered after the visible ones.
    assert.deepEqual(ops.map((op) => op.eventIndex), [2, 1]);
});

test("an op whose event was withheld altogether is dropped: nothing is recorded from an event that never happened", () => {
    const { ops, dropped } = remapBoardOps({
        ops: [{ op: "update", id: "p1", eventIndex: 2 }, { op: "update", id: "p1", eventIndex: 0 }],
        shownEvents: shown,
        visibleEvents: [{ id: "new-a", date: "2014-03-02", title: "Refinery expansion funded" }],
        hiddenEvents: [],
        idMap: new Map([["seg-a", "new-a"]]),
    });
    assert.deepEqual(ops, [{ op: "update", id: "p1", eventIndex: 0 }]);
    assert.equal(dropped, 1);
});

test("an event with no id is found by its date and title", () => {
    const { ops } = remapBoardOps({
        ops: [{ op: "milestone", id: "p1", eventIndex: 0 }],
        shownEvents: [{ date: "2014-03-02", title: "Reactor Goes Critical" }],
        visibleEvents: [{ id: "x1", date: "2014-03-01", title: "Something else" }, { id: "x2", date: "2014-03-02", title: "reactor goes critical" }],
        hiddenEvents: [],
    });
    assert.deepEqual(ops.map((op) => op.eventIndex), [1]);
});

test("an op that named no usable event keeps naming none, for the board's own fallback", () => {
    const { ops, dropped } = remapBoardOps({
        ops: [{ op: "update", id: "p1" }, { op: "update", id: "p2", eventIndex: 99 }, { op: "update", id: "p3", eventIndex: -1 }, "junk", null],
        shownEvents: shown,
        visibleEvents: [{ id: "seg-a", date: "2014-03-02", title: "Refinery expansion funded" }],
        hiddenEvents: [],
    });
    assert.deepEqual(ops, [{ op: "update", id: "p1" }, { op: "update", id: "p2" }, { op: "update", id: "p3" }]);
    assert.equal(dropped, 0);
});

test("with nothing to map, nothing comes back", () => {
    assert.deepEqual(remapBoardOps(), { ops: [], dropped: 0 });
});

// ---- A review that did not come back ------------------------------------------
// It used to land the turn anyway, with nothing on the map moved for it and no
// word to the player. These pin the cases that are not a judgment call; which
// partial answers are worth holding a turn over is reviewNeedsRetry's to decide.

const review = (overrides = {}) => ({ asked: true, parts: {}, reasons: [], failure: null, missing: [], ...overrides });

test("a review whose request failed holds the turn", () => {
    const failed = review({ failure: new Error("503 The model is overloaded"), missing: ["units", "territory", "board"] });
    assert.equal(Boolean(reviewNeedsRetry(failed)), true);
});

test("a review that was never asked, or answered every job, does not hold the turn", () => {
    assert.equal(Boolean(reviewNeedsRetry(review({ asked: false }))), false);
    assert.equal(Boolean(reviewNeedsRetry(review({ parts: { units: {}, board: {} } }))), false);
});

test("the held error is flagged for the UI and says what failed", () => {
    const cause = new Error("The turn review timed out: the model stopped answering.");
    const error = reviewHeldError(review({ failure: cause }));
    assert.equal(error.reviewHeld, true);
    assert.equal(error.cause, cause);
    assert.match(error.message, /nothing has been saved yet/);
    assert.match(error.message, /timed out/);
});

test("with no request error, the held error names the checks that came back empty", () => {
    const error = reviewHeldError(review({ missing: ["units", "territory"] }));
    assert.match(error.message, /no usable answer for units, territory/);
    assert.equal(error.cause, null);
});

test("a map-moving job coming back empty holds the turn; the others fail open alone", () => {
    assert.equal(reviewNeedsRetry(review({ missing: ["units"], parts: { board: {} } })), true);
    assert.equal(reviewNeedsRetry(review({ missing: ["territory"] })), true);
    assert.equal(reviewNeedsRetry(review({ missing: ["board", "timeline", "spies"], parts: { units: {} } })), false);
});
