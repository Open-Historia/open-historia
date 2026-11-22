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
    BACKGROUND_DAILY_CAP,
    BACKGROUND_REQUEST,
    DEFAULT_DAILY_REQUEST_LIMIT,
    JUMP_REQUEST_CAP,
    REQUEST_BUDGET_KEYS,
    SKIP_SPENDERS,
    UNCAPPED_BACKGROUND_TASKS,
    backgroundAllowance,
    createJumpBudget,
    createMemoryStorage,
    createRequestLedger,
    createRequestSettings,
    describeDay,
    describeJumpCost,
    jumpRequestCap,
    keepForRefusedSkip,
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

test("a fresh install saves requests, caps what runs in the background, and assumes a free key", () => {
    const { settings } = setup();
    assert.equal(settings.noRequestLimit(), false);
    assert.equal(settings.saveRequests(), true);
    assert.equal(settings.dailyLimit(), DEFAULT_DAILY_REQUEST_LIMIT);
    assert.equal(settings.dailyLimit(), 500);
    assert.equal(BACKGROUND_DAILY_CAP, 30);
    assert.equal(JUMP_REQUEST_CAP, 3);
});

test("only an explicit choice changes a default", () => {
    const { settings } = setup();
    settings.setNoRequestLimit(true);
    assert.equal(settings.saveRequests(), false);
});

// "get rid of the background agent" (the owner, 2026-11-07): Background AI's
// switch and cap are gone, and a value a player once stored for them is never read.
test("Background AI is not a setting any more: no switch, no cap of the player's", () => {
    const { settings } = setup({ stored: { ai_background_activity: "0", ai_background_daily_cap: "2" } });
    for (const gone of ["backgroundAi", "setBackgroundAi", "backgroundDailyCap", "setBackgroundDailyCap"]) {
        assert.equal(settings[gone], undefined, gone);
    }
    assert.equal(Object.values(REQUEST_BUDGET_KEYS).some((key) => key.startsWith("ai_background")), false);
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
});

test("a storage that throws reads as the defaults", () => {
    const broken = {
        getItem: () => { throw new Error("denied"); },
        setItem: () => { throw new Error("denied"); },
    };
    const settings = createRequestSettings({ storage: broken });
    assert.equal(settings.saveRequests(), true);
    assert.equal(settings.setNoRequestLimit(true), false);
    assert.equal(settings.noRequestLimit(), false);
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
    ledger.note({ status: 200, kind: BACKGROUND_REQUEST, taskKey: "spyIntercept" });
    ledger.note({ status: 200, taskKey: "jumpForward" });
    ledger.note({ status: 429, kind: BACKGROUND_REQUEST, taskKey: "spyIntercept" });
    const day = ledger.today();
    assert.equal(day.used, 2);
    assert.equal(day.background, 1);
});

// "no more limiting it tho, it should be unlimited if its enabled" (the owner,
// 2026-11-09): idle diplomacy is a background request the cap does not count.
test("idle diplomacy is counted in the day and under its task, but not against the background cap", () => {
    const { ledger } = setup();
    assert.deepEqual(UNCAPPED_BACKGROUND_TASKS, ["idleDiplomacy"]);
    ledger.note({ status: 200, kind: BACKGROUND_REQUEST, taskKey: "idleDiplomacy" });
    ledger.note({ status: 200, kind: BACKGROUND_REQUEST, taskKey: "idleDiplomacy" });
    ledger.note({ status: 429, kind: BACKGROUND_REQUEST, taskKey: "idleDiplomacy" });
    const day = ledger.today();
    assert.equal(day.used, 2);
    assert.equal(day.refused, 1);
    assert.equal(day.background, 0);
    assert.deepEqual(day.byTask, { idleDiplomacy: 2 });
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

test("what runs in the background runs from the start, within its cap", () => {
    const { settings, ledger } = setup();
    assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: true, reason: "", remaining: BACKGROUND_DAILY_CAP });
});

test("what runs in the background stops at the day's fixed cap", () => {
    const { settings, ledger } = setup();
    settings.setDailyLimit(10000);
    for (let request = 0; request < BACKGROUND_DAILY_CAP - 1; request += 1) ledger.note({ status: 200, kind: BACKGROUND_REQUEST });
    assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: true, reason: "", remaining: 1 });
    ledger.note({ status: 200, kind: BACKGROUND_REQUEST });
    assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: false, reason: "cap", remaining: 0 });
});

test("a day of idle diplomacy leaves the rest of the background its whole cap", () => {
    const { settings, ledger } = setup();
    settings.setDailyLimit(10000);
    for (let request = 0; request < BACKGROUND_DAILY_CAP * 3; request += 1) {
        ledger.note({ status: 200, kind: BACKGROUND_REQUEST, taskKey: "idleDiplomacy" });
    }
    assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: true, reason: "", remaining: BACKGROUND_DAILY_CAP });
    assert.equal(describeDay({ settings, ledger }).background, 0);
    assert.equal(describeDay({ settings, ledger }).used, BACKGROUND_DAILY_CAP * 3);
});

test("what runs in the background never spends the last tenth of the day", () => {
    const { settings, ledger } = setup();
    settings.setDailyLimit(20);
    for (let request = 0; request < 17; request += 1) ledger.note({ status: 200 });
    assert.equal(backgroundAllowance({ settings, ledger }).allowed, true);
    ledger.note({ status: 200 });
    // 18 used of 20, and the reserve is 2.
    assert.equal(backgroundAllowance({ settings, ledger }).reason, "reserve");
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

test("no budget is without a cap: the one the A/B lab's runs had went with them", () => {
    // Asking for one changes nothing.
    const budget = createJumpBudget({ unlimited: true, only: SKIP_SPENDERS });
    assert.equal("unlimited" in budget, false);
    for (let request = 0; request < 3; request += 1) assert.equal(budget.take("jump"), true);
    assert.equal(budget.take("jump"), false, "the cap holds");
    assert.equal(budget.take("repair"), false, "and so does the list");
    assert.equal(budget.spent, 3);
    assert.equal(budget.remaining, 0);
    assert.equal(budget.free, 0);
    assert.deepEqual(budget.skipped, ["jump"]);
    assert.deepEqual(budget.denied, ["repair"]);
});

// ---------------------------------------------------------------------------
// The owner's rule (2026-10): a time skip is ONE request; function calling is
// what can make it more, and never more than three.

const skipBudget = ({ segments = 1, ballots = false } = {}) => {
    const budget = createJumpBudget({ cap: jumpRequestCap({ segments }), only: SKIP_SPENDERS });
    budget.reserve("jump", segments);
    if (ballots) budget.reserve("institutionBallots", 1);
    return budget;
};

test("a skip with no function calling is one request, with two left that only its own list may ask for", () => {
    const budget = skipBudget();
    assert.equal(budget.take("jump"), true);
    assert.equal(budget.spent, 1);
    assert.equal(budget.free, 2);
    // What used to be asked after a skip, each a request of its own: the last
    // three (the turn review, the event consolidator and the Stats refresh)
    // went on 2026-11-07.
    for (const gone of ["geography", "repair", "spies", "unitDirector", "timelineCurator", "projects", "review", "history", "stats"]) {
        assert.equal(budget.allows(gone), false, gone);
        assert.equal(budget.take(gone), false, gone);
    }
    assert.equal(budget.spent, 1, "none of them cost anything");
    assert.deepEqual(budget.skipped, [], "nor were they put off for the cap: a skip does not ask for them at all");
    assert.deepEqual(budget.denied, ["geography", "repair", "spies", "unitDirector", "timelineCurator", "projects", "review", "history", "stats"]);
    assert.deepEqual(SKIP_SPENDERS, ["jump", "institutionBallots"]);
});

test("function calling is the skip asking again: two rounds make three requests, and then it answers", () => {
    const budget = skipBudget();
    assert.equal(budget.take("jump"), true);
    assert.equal(budget.free, 2, "two rounds of questions may be asked");
    assert.equal(budget.allows("jumpLookup"), true, "a lookup is the skip's own request");
    assert.equal(budget.take("jumpLookup"), true);
    assert.equal(budget.take("jumpLookup"), true);
    assert.equal(budget.free, 0, "the next request has to be the answer");
    assert.equal(budget.spent, JUMP_REQUEST_CAP);
    assert.equal(budget.take("jumpRetry"), false, "and a flawed answer is not asked for again on top of that");
    assert.equal(budget.take("institutionBallots"), false);
    assert.deepEqual(budget.skipped, ["jumpRetry", "institutionBallots"]);
    assert.deepEqual(budget.denied, []);
});

test("an answer that could not be used at all is asked for once more, inside the same three", () => {
    const budget = skipBudget();
    budget.take("jump");
    assert.equal(budget.take("jumpRetry"), true);
    assert.equal(budget.free, 1);
});

test("every segment keeps its own request, whatever asks first", () => {
    const budget = skipBudget({ segments: 3 });
    assert.equal(budget.cap, 5);
    assert.equal(budget.take("jump"), true);
    assert.equal(budget.free, 2, "the two segments still to come are not on offer");
    assert.equal(budget.take("jumpLookup"), true);
    assert.equal(budget.take("jumpLookup"), true);
    assert.equal(budget.free, 0);
    assert.equal(budget.take("jumpLookup"), false, "a third round would cost a later segment its skip");
    assert.equal(budget.take("jump"), true);
    assert.equal(budget.take("jump"), true);
    assert.equal(budget.spent, 5);
});

test("an open ballot keeps its request, and function calling gets what is left", () => {
    const budget = skipBudget({ ballots: true });
    budget.take("jump");
    assert.equal(budget.free, 1);
    assert.equal(budget.take("jumpLookup"), true);
    assert.equal(budget.take("jumpLookup"), false);
    assert.equal(budget.take("institutionBallots"), true);
    assert.equal(budget.spent, 3);
});

test("what a skip spends on survives a restart with the rest of its budget", () => {
    const budget = skipBudget();
    budget.take("jump");
    budget.take("geography");
    const carried = JSON.parse(JSON.stringify({ cap: budget.cap, only: budget.only, state: budget.state }));
    const resumed = createJumpBudget({ cap: carried.cap, only: carried.only, state: carried.state });
    assert.equal(resumed.allows("repair"), false);
    assert.equal(resumed.allows("history"), false);
    assert.equal(resumed.allows("institutionBallots"), true);
    assert.deepEqual(resumed.denied, ["geography"]);
    assert.equal(resumed.spent, 1);
});

test("a segmented skip pays one request per segment and the cap moves with it", () => {
    assert.equal(jumpRequestCap({ segments: 1 }), 3);
    assert.equal(jumpRequestCap({ segments: 4 }), 6);
    assert.equal(jumpRequestCap({ segments: 0 }), 3);
});

test("what a skip is said to cost: one request, and up to the cap only with function calling", () => {
    assert.deepEqual(describeJumpCost(), { min: 1, max: 1, lookups: false, rounds: 0, unlimited: false });
    assert.deepEqual(describeJumpCost({ lookups: false, segments: 3 }), { min: 3, max: 3, lookups: false, rounds: 0, unlimited: false });
    assert.deepEqual(describeJumpCost({ lookups: true }), { min: 1, max: 3, lookups: true, rounds: 3, unlimited: false });
    assert.deepEqual(describeJumpCost({ lookups: true, segments: 3 }), { min: 3, max: 5, lookups: true, rounds: 3, unlimited: false });
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

// Upkeep after a skip (the Stats refresh, a history fold of its own) kept a
// request of the skip's so function calling could not starve it. Both went on
// 2026-11-07, and with them the reservation: a skip keeps requests only for its
// own segments and an open ballot.

// The owner, 2026-11-07: "My key has no request limit" on by default when the
// main provider is anything other than Gemini.
{
    const { createRequestSettings: settingsOver, defaultNoRequestLimit: defaultOver, readMainProvider: mainOver } = await import("./requestBudget.js");
    const withMain = (provider, extra = {}) => createMemoryStorage({
        ai_connections: JSON.stringify([{ id: "a", provider }, { id: "b", provider: "gemini" }]),
        ai_fallback_list: JSON.stringify([{ id: "e1", connectionId: "a" }, { id: "e2", connectionId: "b" }]),
        ...extra,
    });
    const agree = (settings, on) => {
        assert.equal(settings.noRequestLimit(), on);
        assert.equal(settings.unlimited(), on);
        assert.equal(settings.saveRequests(), !on);
    };

    test("no request limit: off by default with Gemini as the main provider", () => {
        const storage = withMain("gemini");
        assert.equal(mainOver(storage), "gemini");
        agree(settingsOver({ storage }), false);
        agree(settingsOver({ storage: createMemoryStorage() }), false);
    });

    test("no request limit: on by default with any other main provider", () => {
        for (const provider of ["openai", "anthropic", "openai-compatible", "openrouter"]) {
            const storage = withMain(provider);
            assert.equal(defaultOver(storage), true);
            agree(settingsOver({ storage }), true);
        }
        agree(settingsOver({ storage: createMemoryStorage({ api_provider: "openai" }) }), true);
    });

    test("no request limit: an explicit choice wins, and the default follows the main provider", () => {
        const off = withMain("openai", { ai_no_request_limit: "0" });
        agree(settingsOver({ storage: off }), false);
        const on = withMain("gemini", { ai_no_request_limit: "1" });
        agree(settingsOver({ storage: on }), true);
        // Old switches count as a choice.
        agree(settingsOver({ storage: withMain("openai", { ai_save_requests: "1" }) }), false);
        // Set off through the switch, it stays off.
        const storage = withMain("openai");
        const settings = settingsOver({ storage });
        agree(settings, true);
        settings.setNoRequestLimit(false);
        agree(settings, false);
        // Never touched: follows a change of main provider.
        const follow = withMain("openai");
        const followed = settingsOver({ storage: follow });
        agree(followed, true);
        follow.setItem("ai_fallback_list", JSON.stringify([{ id: "e2", connectionId: "b" }, { id: "e1", connectionId: "a" }]));
        agree(followed, false);
    });

    test("no request limit: the game's getters and the time panel read the same value", async () => {
        const fs = await import("node:fs");
        const time = fs.readFileSync(new URL("../GameUI/time.jsx", import.meta.url), "utf8");
        assert.match(time, /import \{[^}]*savingRequests[^}]*\} from "\.\.\/AI\/requestBudget\.js"/);
        const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
        assert.match(gameplay, /const lookupFunctionsEnabled = \(\) => !savingRequests\(\)/);
        const settingsUi = fs.readFileSync(new URL("../GameUI/settings.jsx", import.meta.url), "utf8");
        assert.match(settingsUi, /useState\(\(\) => requestSettings\.noRequestLimit\(\)\)/);
    });
}

// The owner's log, 2026-11-04: the folded skip refused (400), one request
// spent, and the skip asked again was "Not asked: this time skip has used its
// 3 requests". Nothing is asked after a skip now, so the retry keeps its request.
test("a refused folded skip is asked again with a request of its own", () => {
    const budget = createJumpBudget({ cap: JUMP_REQUEST_CAP, only: SKIP_SPENDERS });
    budget.reserve("jump", 1);
    assert.equal(budget.take("jump"), true, "the folded skip, refused");
    assert.equal(keepForRefusedSkip(budget), 1);
    assert.equal(budget.take("jump"), true, "asked again the old way");
    assert.equal(budget.spent, 2);

    // A skip in segments: the later segments keep theirs.
    const pieces = createJumpBudget({ cap: jumpRequestCap({ segments: 3 }), only: SKIP_SPENDERS });
    pieces.reserve("jump", 3);
    pieces.take("jump");
    assert.equal(keepForRefusedSkip(pieces), 1);
    assert.deepEqual([1, 2, 3].map(() => pieces.take("jump")), [true, true, true], "this segment again, and the two after it");
    assert.equal(keepForRefusedSkip(null), 0);
});
