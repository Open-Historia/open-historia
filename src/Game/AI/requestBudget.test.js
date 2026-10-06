/*! Open Historia — the request budget: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/requestBudget.test.js
//
// Runs without node_modules: requestBudget.js imports only fallbackRunner.js,
// which imports nothing.
//
// The numbers here are a promise to the player with a free key: a skip is one
// request where it can be and never more than three, and nothing spends while
// they are not pressing anything. Each default is pinned, because a default
// that drifts is a player who runs out of requests at lunchtime and never
// learns why.

import test from "node:test";
import assert from "node:assert/strict";

import {
    BACKGROUND_REQUEST,
    DEFAULT_BACKGROUND_DAILY_CAP,
    DEFAULT_DAILY_REQUEST_LIMIT,
    JUMP_REQUEST_CAP,
    REQUEST_BUDGET_KEYS,
    backgroundAllowance,
    createJumpBudget,
    createMemoryStorage,
    createRequestLedger,
    createRequestSettings,
    describeDay,
    describeJumpCost,
    jumpRequestCap,
    requestsByTask,
} from "./requestBudget.js";

// 2026-09-17 12:00 in Los Angeles (UTC-7 in September).
const NOON_PACIFIC = Date.UTC(2026, 8, 17, 19, 0, 0);
const HOUR = 60 * 60 * 1000;

const setup = ({ stored = {}, at = NOON_PACIFIC } = {}) => {
    const storage = createMemoryStorage(stored);
    const clock = { at };
    const settings = createRequestSettings({ storage });
    const ledger = createRequestLedger({ storage, now: () => clock.at });
    return { storage, clock, settings, ledger };
};

test("a fresh install saves requests, runs background AI within its cap, and assumes a free key", () => {
    const { settings } = setup();
    assert.equal(settings.saveRequests(), true);
    assert.equal(settings.backgroundAi(), true);
    assert.equal(settings.dailyLimit(), DEFAULT_DAILY_REQUEST_LIMIT);
    assert.equal(settings.dailyLimit(), 500);
    assert.equal(settings.backgroundDailyCap(), DEFAULT_BACKGROUND_DAILY_CAP);
    assert.equal(JUMP_REQUEST_CAP, 3);
});

test("only an explicit choice changes a default", () => {
    const { settings, storage } = setup();
    settings.setSaveRequests(false);
    settings.setBackgroundAi(false);
    assert.equal(settings.saveRequests(), false);
    assert.equal(settings.backgroundAi(), false);
    assert.equal(storage.getItem(REQUEST_BUDGET_KEYS.backgroundAi), "0");
});

// The six switches for the checks after a time skip are gone: the checks are
// part of the skip. A player who once turned one off gets it back, because the
// key they set is no longer read by anything.
test("a check a player once switched off is on again: there is no switch left to read", () => {
    const { settings } = setup({ stored: {
        ai_review_units: "0", ai_review_territory: "0", ai_review_structures: "0",
        ai_review_timeline: "0", ai_review_board: "0", ai_review_spies: "0",
    } });
    assert.equal(settings.reviewSection, undefined);
    assert.equal(settings.setReviewSection, undefined);
    assert.equal(Object.values(REQUEST_BUDGET_KEYS).some((key) => key.startsWith("ai_review_")), false);
    // And the settings that are left read as they always did beside them.
    assert.equal(settings.saveRequests(), true);
});

test("the limits are whole numbers inside their range, whatever was typed", () => {
    const { settings } = setup();
    settings.setDailyLimit("1500");
    assert.equal(settings.dailyLimit(), 1500);
    settings.setDailyLimit("0");
    assert.equal(settings.dailyLimit(), 1, "a limit of nothing would lock the player out");
    settings.setDailyLimit("lots");
    assert.equal(settings.dailyLimit(), DEFAULT_DAILY_REQUEST_LIMIT);
    settings.setBackgroundDailyCap(12.6);
    assert.equal(settings.backgroundDailyCap(), 13);
    settings.setBackgroundDailyCap(-4);
    assert.equal(settings.backgroundDailyCap(), 0);
});

test("a storage that throws reads as the defaults", () => {
    const broken = {
        getItem: () => { throw new Error("denied"); },
        setItem: () => { throw new Error("denied"); },
    };
    const settings = createRequestSettings({ storage: broken });
    assert.equal(settings.saveRequests(), true);
    assert.equal(settings.backgroundAi(), true);
    assert.equal(settings.setSaveRequests(false), false);
    const ledger = createRequestLedger({ storage: broken, now: () => NOON_PACIFIC });
    assert.equal(ledger.note({ status: 200 }).used, 1, "the count is still returned, it just is not kept");
    assert.equal(ledger.today().used, 0);
});

test("only an answered request is counted as used", () => {
    const { ledger } = setup();
    ledger.note({ status: 200, taskKey: "jumpForward" });
    ledger.note({ status: 200, taskKey: "jumpForward" });
    ledger.note({ status: 429, taskKey: "jumpForward" });
    ledger.note({ status: 503, taskKey: "advisor" });
    ledger.note({ status: 200, taskKey: "advisor" });
    const day = ledger.today();
    assert.equal(day.used, 3);
    assert.equal(day.refused, 1, "a 429 costs a wait, not allowance");
    assert.equal(day.failed, 1);
    assert.deepEqual(day.byTask, { jumpForward: 2, advisor: 1 });
});

test("background requests are counted inside the day and on their own", () => {
    const { ledger } = setup();
    ledger.note({ status: 200, kind: BACKGROUND_REQUEST, taskKey: "idleDiplomacy" });
    ledger.note({ status: 200, taskKey: "jumpForward" });
    ledger.note({ status: 429, kind: BACKGROUND_REQUEST, taskKey: "idleDiplomacy" });
    const day = ledger.today();
    assert.equal(day.used, 2);
    assert.equal(day.background, 1);
});

test("the day turns over at midnight Pacific, not at local midnight", () => {
    const { ledger, clock } = setup();
    ledger.note({ status: 200 });
    const resetAt = ledger.today().resetAt;
    // Midnight in Los Angeles on the 18th is 07:00 UTC.
    assert.equal(resetAt, Date.UTC(2026, 8, 18, 7, 0, 0));
    clock.at = resetAt - 1;
    assert.equal(ledger.today().used, 1);
    clock.at = resetAt;
    assert.equal(ledger.today().used, 0);
    assert.equal(ledger.today().resetAt, Date.UTC(2026, 8, 19, 7, 0, 0));
});

test("a record from a clock that was later put back is not trusted", () => {
    const { ledger, clock } = setup();
    ledger.note({ status: 200 });
    clock.at = NOON_PACIFIC - 3 * 24 * HOUR;
    assert.equal(ledger.today().used, 0);
});

test("a damaged record reads as an empty day", () => {
    for (const stored of ["not json", "[]", "null", JSON.stringify({ used: "many", resetAt: "soon" })]) {
        const { ledger } = setup({ stored: { [REQUEST_BUDGET_KEYS.ledger]: stored } });
        const day = ledger.today();
        assert.equal(day.used, 0, stored);
        assert.equal(day.resetAt, Date.UTC(2026, 8, 18, 7, 0, 0), stored);
    }
});

test("the ledger tells its listener, and a listener that throws costs nothing", () => {
    const storage = createMemoryStorage();
    let heard = 0;
    const ledger = createRequestLedger({
        storage,
        now: () => NOON_PACIFIC,
        onChange: () => { heard += 1; throw new Error("a panel fell over"); },
    });
    assert.equal(ledger.note({ status: 200 }).used, 1);
    assert.equal(heard, 1);
    assert.equal(ledger.today().used, 1);
});

test("what the last skip cost is kept for the time panel", () => {
    const { ledger } = setup();
    assert.equal(describeDay({ settings: createRequestSettings({ storage: createMemoryStorage() }), ledger }).lastJump, null);
    ledger.noteJump({ used: 2, refused: 1 });
    assert.deepEqual(ledger.today().lastJump, { used: 2, refused: 1, at: NOON_PACIFIC });
});

test("background AI runs from the start within its cap, and spends nothing once turned off", () => {
    const { settings, ledger } = setup();
    assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: true, reason: "", remaining: DEFAULT_BACKGROUND_DAILY_CAP });
    settings.setBackgroundAi(false);
    assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: false, reason: "off", remaining: 0 });
});

test("background AI stops at its daily cap", () => {
    const { settings, ledger } = setup();
    settings.setBackgroundAi(true);
    settings.setBackgroundDailyCap(2);
    assert.equal(backgroundAllowance({ settings, ledger }).allowed, true);
    ledger.note({ status: 200, kind: BACKGROUND_REQUEST });
    assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: true, reason: "", remaining: 1 });
    ledger.note({ status: 200, kind: BACKGROUND_REQUEST });
    assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: false, reason: "cap", remaining: 0 });
});

test("background AI never spends the last tenth of the day", () => {
    const { settings, ledger } = setup();
    settings.setBackgroundAi(true);
    settings.setDailyLimit(20);
    for (let request = 0; request < 17; request += 1) ledger.note({ status: 200 });
    assert.equal(backgroundAllowance({ settings, ledger }).allowed, true);
    ledger.note({ status: 200 });
    // 18 used of 20, and the reserve is 2.
    assert.equal(backgroundAllowance({ settings, ledger }).reason, "reserve");
});

test("a cap of zero is background AI switched on and allowed nothing", () => {
    const { settings, ledger } = setup();
    settings.setBackgroundAi(true);
    settings.setBackgroundDailyCap(0);
    assert.equal(backgroundAllowance({ settings, ledger }).reason, "cap");
});

test("a skip spends at most its cap, in the order it is asked", () => {
    const budget = createJumpBudget();
    assert.equal(budget.cap, 3);
    assert.equal(budget.take("jump"), true);
    assert.equal(budget.take("review"), true);
    assert.equal(budget.remaining, 1);
    assert.equal(budget.take("history"), true);
    assert.equal(budget.take("repair"), false);
    assert.equal(budget.take("repair"), false);
    assert.equal(budget.spent, 3);
    assert.equal(budget.remaining, 0);
    assert.deepEqual(budget.skipped, ["repair", "repair"]);
    assert.deepEqual(budget.log.map((entry) => entry.granted), [true, true, true, false, false]);
});


test("a reserved institutional ballot slot cannot be consumed by earlier optional work", () => {
    const budget = createJumpBudget();
    budget.reserve("institutionBallots", 1);
    assert.equal(budget.reserved, 1);
    assert.equal(budget.take("jump"), true);
    assert.equal(budget.take("review"), true);
    assert.equal(budget.take("history"), false, "history yields to already-open formal governance");
    assert.equal(budget.take("stats"), false, "tracked stats cannot consume the reserved legal-governance slot");
    assert.equal(budget.take("institutionBallots"), true);
    assert.equal(budget.spent, 3);
    assert.equal(budget.reserved, 0);
    assert.deepEqual(budget.skipped, ["history", "stats"]);
});

test("a budget carried over a restart spends on from where it was, reservation and all", () => {
    const budget = createJumpBudget({ cap: 4 });
    budget.reserve("institutionBallots", 1);
    budget.take("jump");
    budget.take("review");
    budget.take("history");
    const carried = JSON.parse(JSON.stringify({ cap: budget.cap, state: budget.state }));
    const resumed = createJumpBudget({ cap: carried.cap, state: carried.state });
    assert.equal(resumed.spent, 3);
    assert.equal(resumed.reserved, 1);
    assert.equal(resumed.take("stats"), false, "the slot left is still the ballots'");
    assert.equal(resumed.take("institutionBallots"), true);
    assert.deepEqual(resumed.log.map((entry) => entry.spender), ["jump", "review", "history", "stats", "institutionBallots"]);
    assert.deepEqual(resumed.skipped, ["stats"]);
});

test("a skip that is not saving requests is never refused, and still keeps its log", () => {
    const budget = createJumpBudget({ unlimited: true });
    for (let request = 0; request < 12; request += 1) assert.equal(budget.take("jump"), true);
    assert.equal(budget.spent, 12);
    assert.equal(budget.remaining, Infinity);
    assert.deepEqual(budget.skipped, []);
});

test("a segmented skip pays one request per segment and the cap moves with it", () => {
    assert.equal(jumpRequestCap({ segments: 1 }), 3);
    assert.equal(jumpRequestCap({ segments: 4 }), 6);
    assert.equal(jumpRequestCap({ segments: 0 }), 3);
    assert.deepEqual(describeJumpCost({ saveRequests: true, segments: 1 }), { min: 1, max: 3, capped: true });
    assert.deepEqual(describeJumpCost({ saveRequests: true, segments: 3 }), { min: 3, max: 5, capped: true });
    assert.deepEqual(describeJumpCost({ saveRequests: false }), { min: 1, max: null, capped: false });
});

test("the day is described for the panel: used, left, and never less than nothing left", () => {
    const { settings, ledger } = setup();
    settings.setDailyLimit(2);
    ledger.note({ status: 200, taskKey: "jumpForward" });
    ledger.note({ status: 200, taskKey: "afterJumpReview" });
    ledger.note({ status: 200, taskKey: "advisor" });
    const day = describeDay({ settings, ledger });
    assert.equal(day.used, 3);
    assert.equal(day.limit, 2);
    assert.equal(day.left, 0);
    assert.deepEqual(day.byTask, { jumpForward: 1, afterJumpReview: 1, advisor: 1 });
});

test("Settings lists today's requests by task, most first, under their names", () => {
    const { ledger } = setup();
    for (const taskKey of ["advisor", "jumpForward", "jumpForward", "translation", "other", "direct", "diplomacy → France"]) {
        ledger.note({ status: 200, taskKey });
    }
    ledger.note({ status: 429, taskKey: "advisor" });
    const labels = { jumpForward: "Time skip", advisor: "Advisor chat", translation: "Translation", other: "Other", direct: "Other" };
    assert.deepEqual(requestsByTask(ledger.today().byTask, labels), [
        { label: "Other", named: true, count: 2 },
        { label: "Time skip", named: true, count: 2 },
        { label: "Advisor chat", named: true, count: 1 },
        { label: "Translation", named: true, count: 1 },
        { label: "diplomacy → France", named: false, count: 1 },
    ]);
    assert.deepEqual(requestsByTask({}, labels), []);
    assert.deepEqual(requestsByTask(null), []);
    assert.deepEqual(requestsByTask({ toString: 3 }), [{ label: "toString", named: false, count: 3 }], "a key is never read off the prototype");
});
