/*! Open Historia — the request budget: how many provider requests the game spends, and on what © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The request budget, in one place (docs/ai-overview.md, "The request budget").
//
// Most players bring a free Gemini key. On that tier tokens are close to free
// and REQUESTS are what run out: a few hundred a day, a handful a minute. So
// the yardstick for every AI feature is how many requests a player action
// costs, not how long its prompt is. A time skip is ONE request where it can
// be, and never more than JUMP_REQUEST_CAP; what the game spends while the
// player is not pressing anything stops at a daily cap, and at nothing when
// the player turns it off.
//
// Three parts, all plain data and rules:
//   - the SETTINGS a player chooses (save requests, background AI, the limits);
//   - the LEDGER of what today has cost, counted where the requests are made
//     (main.jsx tells it about every provider response);
//   - the JUMP BUDGET one time skip spends from, in a fixed order of priority.
//
// DELIBERATELY FREE OF THE GAME, like fallbackRunner.js (its one import, for
// the quota day): main.jsx makes the calls and cannot be unit-tested, and these
// rules are exactly what needs to be. The caller hands in where settings are
// kept and a clock.

import { nextPacificMidnight } from "./fallbackRunner.js";

// What a free Gemini key allows in a day, near enough; the player can change it.
export const DEFAULT_DAILY_REQUEST_LIMIT = 500;
// What background AI may spend in a day.
export const DEFAULT_BACKGROUND_DAILY_CAP = 30;
// Background AI also stops while less than this share of the day is left, so
// the last requests of the day are always the player's own.
export const BACKGROUND_RESERVE_SHARE = 0.1;
// The most one time skip may spend while requests are being saved.
export const JUMP_REQUEST_CAP = 3;

export const REQUEST_BUDGET_KEYS = Object.freeze({
    // ON unless the player turned it off ("0"): an absent key saves requests.
    saveRequests: "ai_save_requests",
    // ON unless the player turned it off ("0"), within its daily cap.
    backgroundAi: "ai_background_activity",
    dailyLimit: "ai_daily_request_limit",
    backgroundDailyCap: "ai_background_daily_cap",
    ledger: "ai_request_ledger",
});

// The checks one request after a time skip can carry (afterJumpReview in
// gameplay.js). Each is ON unless the player turned it off.
export const REVIEW_SECTIONS = Object.freeze(["units", "territory", "structures", "timeline", "board", "spies"]);
export const reviewSectionKey = (section) => `ai_review_${section}`;

// --- Where settings are kept ---
//
// localStorage in the game; a map in the tests and the harness. Reads never
// throw: a browser that refuses storage simply runs on the defaults.
export const createMemoryStorage = (initial = {}) => {
    const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => { values.set(key, String(value)); },
        removeItem: (key) => { values.delete(key); },
    };
};

// Resolved at every read rather than once: the harness installs its
// localStorage after the game's modules have loaded.
const fallbackMemory = createMemoryStorage();
const resolveStorage = () => {
    try {
        if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch { /* storage refused: the defaults apply */ }
    return fallbackMemory;
};
const liveStorage = {
    getItem: (key) => resolveStorage().getItem(key),
    setItem: (key, value) => resolveStorage().setItem(key, value),
    removeItem: (key) => resolveStorage().removeItem?.(key),
};
const defaultStorage = () => liveStorage;

const readItem = (storage, key) => {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
};

const writeItem = (storage, key, value) => {
    try {
        storage.setItem(key, value);
        return true;
    } catch {
        return false; // storage full or refused: a count is advice, not a save
    }
};

const wholeNumber = (value, { min, max, fallback }) => {
    const number = Math.round(Number(value));
    if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
};

// --- The settings ---

export const createRequestSettings = ({ storage = defaultStorage() } = {}) => ({
    saveRequests: () => readItem(storage, REQUEST_BUDGET_KEYS.saveRequests) !== "0",
    backgroundAi: () => readItem(storage, REQUEST_BUDGET_KEYS.backgroundAi) !== "0",
    dailyLimit: () => wholeNumber(readItem(storage, REQUEST_BUDGET_KEYS.dailyLimit), {
        min: 1, max: 1000000, fallback: DEFAULT_DAILY_REQUEST_LIMIT,
    }),
    backgroundDailyCap: () => wholeNumber(readItem(storage, REQUEST_BUDGET_KEYS.backgroundDailyCap), {
        min: 0, max: 1000000, fallback: DEFAULT_BACKGROUND_DAILY_CAP,
    }),
    reviewSection: (section) => REVIEW_SECTIONS.includes(section)
        && readItem(storage, reviewSectionKey(section)) !== "0",
    setSaveRequests: (on) => writeItem(storage, REQUEST_BUDGET_KEYS.saveRequests, on ? "1" : "0"),
    setBackgroundAi: (on) => writeItem(storage, REQUEST_BUDGET_KEYS.backgroundAi, on ? "1" : "0"),
    setDailyLimit: (value) => writeItem(storage, REQUEST_BUDGET_KEYS.dailyLimit,
        String(wholeNumber(value, { min: 1, max: 1000000, fallback: DEFAULT_DAILY_REQUEST_LIMIT }))),
    setBackgroundDailyCap: (value) => writeItem(storage, REQUEST_BUDGET_KEYS.backgroundDailyCap,
        String(wholeNumber(value, { min: 0, max: 1000000, fallback: DEFAULT_BACKGROUND_DAILY_CAP }))),
    setReviewSection: (section, on) => REVIEW_SECTIONS.includes(section)
        && writeItem(storage, reviewSectionKey(section), on ? "1" : "0"),
});

// --- The ledger ---
//
// One day at a time. The day is Google's: the free tier resets at midnight
// Pacific, and that is the allowance nearly every player is counting against.
// Other providers do not publish a day at all, so one rule serves everyone.
//
// `used` counts requests the provider ANSWERED (a 2xx). A 429 is a request the
// provider refused to take, which costs the player a wait and no allowance, so
// it is counted apart; so is anything else that failed.

const emptyDay = (at) => ({
    version: 1,
    startedAt: at,
    resetAt: nextPacificMidnight(at),
    used: 0,
    background: 0,
    refused: 0,
    failed: 0,
    byTask: {},
    lastJump: null,
});

const TASK_ROWS_KEPT = 40;

const normalizeDay = (value, at) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return emptyDay(at);
    const resetAt = Number(value.resetAt);
    // A new day, or a record from a clock that has since been put back.
    if (!Number.isFinite(resetAt) || resetAt <= at || resetAt - at > 26 * 60 * 60 * 1000) return emptyDay(at);
    const count = (field) => wholeNumber(value[field], { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
    const byTask = {};
    if (value.byTask && typeof value.byTask === "object" && !Array.isArray(value.byTask)) {
        for (const [task, total] of Object.entries(value.byTask).slice(0, TASK_ROWS_KEPT)) {
            const requests = wholeNumber(total, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
            if (task && requests > 0) byTask[task] = requests;
        }
    }
    const lastJump = value.lastJump && typeof value.lastJump === "object" && !Array.isArray(value.lastJump)
        ? {
            used: wholeNumber(value.lastJump.used, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }),
            refused: wholeNumber(value.lastJump.refused, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }),
            at: Number.isFinite(Number(value.lastJump.at)) ? Number(value.lastJump.at) : at,
        }
        : null;
    return {
        version: 1,
        startedAt: Number.isFinite(Number(value.startedAt)) ? Number(value.startedAt) : at,
        resetAt,
        used: count("used"),
        background: count("background"),
        refused: count("refused"),
        failed: count("failed"),
        byTask,
        lastJump,
    };
};

export const BACKGROUND_REQUEST = "background";
export const PLAYER_REQUEST = "player";

export const createRequestLedger = ({ storage = defaultStorage(), now = Date.now, onChange = null } = {}) => {
    const read = () => {
        const at = now();
        let stored = null;
        try {
            stored = JSON.parse(readItem(storage, REQUEST_BUDGET_KEYS.ledger) ?? "null");
        } catch {
            stored = null;
        }
        return normalizeDay(stored, at);
    };
    const write = (day) => {
        writeItem(storage, REQUEST_BUDGET_KEYS.ledger, JSON.stringify(day));
        try {
            onChange?.(day);
        } catch { /* a listener must never cost a request its count */ }
        return day;
    };
    return {
        today: read,
        // One provider response. `status` is the HTTP status; `kind` says whether
        // the player asked for this (a skip, a chat message, a panel they opened)
        // or the game did it by itself in the background.
        note: ({ status, kind = PLAYER_REQUEST, taskKey = "" } = {}) => {
            const day = read();
            const code = Number(status);
            if (code >= 200 && code < 300) {
                day.used += 1;
                if (kind === BACKGROUND_REQUEST) day.background += 1;
                const task = String(taskKey || "other").slice(0, 60);
                if (task in day.byTask || Object.keys(day.byTask).length < TASK_ROWS_KEPT) {
                    day.byTask[task] = (day.byTask[task] || 0) + 1;
                }
            } else if (code === 429) {
                day.refused += 1;
            } else {
                day.failed += 1;
            }
            return write(day);
        },
        // What the time skip that just finished cost, for the time panel.
        noteJump: ({ used = 0, refused = 0 } = {}) => {
            const day = read();
            day.lastJump = {
                used: wholeNumber(used, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }),
                refused: wholeNumber(refused, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }),
                at: now(),
            };
            return write(day);
        },
        reset: () => write(emptyDay(now())),
    };
};

// --- Background AI ---
//
// Anything the game would do with nobody pressing a button: a country writing
// to the player unprompted, an agent filing a report on a timer, a first
// reading of a service nobody asked about. On unless the player turns it off,
// capped for the day, and never out of the last tenth of the allowance.
export const backgroundAllowance = ({ settings, ledger }) => {
    if (!settings.backgroundAi()) return { allowed: false, reason: "off", remaining: 0 };
    const day = ledger.today();
    const cap = settings.backgroundDailyCap();
    const remaining = Math.max(0, cap - day.background);
    if (remaining <= 0) return { allowed: false, reason: "cap", remaining: 0 };
    const limit = settings.dailyLimit();
    const reserve = Math.ceil(limit * BACKGROUND_RESERVE_SHARE);
    if (day.used + reserve >= limit) return { allowed: false, reason: "reserve", remaining };
    return { allowed: true, reason: "", remaining };
};

// --- One time skip ---
//
// Who may spend, in order, while requests are being saved. The skip itself
// always runs. Everything after it asks first, and a "no" is never an error:
// the checks fail open, the agents report next turn, the history is folded on
// a later skip.
export const JUMP_SPENDERS = Object.freeze([
    "jump",          // the time skip itself
    "jumpRetry",     // asked again, only when the first answer could not be used at all
    "review",        // units, territory, timeline, board and agents, in one request
    "history",       // folding old events into the history document, when due
    "repair",        // a second search when the skip came back thin
    "institutionBallots", // unresolved NPC formal ballots after the new turn is canonical
]);

// A skip generated in segments (Settings → AI) pays one request per segment:
// the player chose that, so the cap moves with it rather than breaking the skip.
export const jumpRequestCap = ({ segments = 1 } = {}) => JUMP_REQUEST_CAP + Math.max(0, Math.round(Number(segments) || 1) - 1);

export const createJumpBudget = ({ cap = JUMP_REQUEST_CAP, unlimited = false } = {}) => {
    const spends = [];
    const reservations = new Map();
    const limit = Math.max(1, Math.round(Number(cap) || JUMP_REQUEST_CAP));
    const spent = () => spends.filter((entry) => entry.granted).length;
    const reserved = () => [...reservations.values()].reduce((sum, value) => sum + value, 0);
    return {
        cap: limit,
        unlimited,
        // Reserve a bounded slot for correctness work that happens late in the
        // turn. Optional work asked earlier cannot consume that slot, but the
        // total request cap never increases.
        reserve: (spender, count = 1) => {
            if (unlimited) return 0;
            const key = String(spender || "other");
            const wanted = Math.max(0, Math.round(Number(count) || 0));
            if (!wanted) return reservations.get(key) || 0;
            const capacity = Math.max(0, limit - spent() - reserved());
            const added = Math.min(wanted, capacity);
            if (added) reservations.set(key, (reservations.get(key) || 0) + added);
            return reservations.get(key) || 0;
        },
        // May this spender make one request? Recorded either way, so the turn's
        // log can say what was skipped to stay inside the cap.
        take: (spender) => {
            const key = String(spender || "other");
            const ownReservation = reservations.get(key) || 0;
            const granted = unlimited || (
                ownReservation > 0
                    ? spent() < limit
                    : spent() < Math.max(0, limit - reserved())
            );
            if (granted && ownReservation > 0) {
                if (ownReservation === 1) reservations.delete(key);
                else reservations.set(key, ownReservation - 1);
            }
            spends.push({ spender: key, granted });
            return granted;
        },
        get spent() { return spent(); },
        get remaining() { return unlimited ? Infinity : Math.max(0, limit - spent()); },
        get reserved() { return unlimited ? 0 : reserved(); },
        get skipped() { return spends.filter((entry) => !entry.granted).map((entry) => entry.spender); },
        get log() { return spends.map((entry) => ({ ...entry })); },
    };
};

// What the time panel says a skip will cost before the player presses it.
export const describeJumpCost = ({ saveRequests, segments = 1 } = {}) => {
    const pieces = Math.max(1, Math.round(Number(segments) || 1));
    if (saveRequests) return { min: pieces, max: jumpRequestCap({ segments: pieces }), capped: true };
    return { min: pieces, max: null, capped: false };
};

// "37 of 500 today" — and what is left, never below zero.
export const describeDay = ({ settings, ledger }) => {
    const day = ledger.today();
    const limit = settings.dailyLimit();
    return {
        used: day.used,
        limit,
        left: Math.max(0, limit - day.used),
        background: day.background,
        backgroundCap: settings.backgroundDailyCap(),
        refused: day.refused,
        failed: day.failed,
        resetAt: day.resetAt,
        byTask: { ...day.byTask },
        lastJump: day.lastJump ? { ...day.lastJump } : null,
    };
};

// --- The game's own ---
//
// One ledger and one set of settings for the running game, over localStorage
// (or memory where there is none). The UI hears changes through a window event.
const announce = () => {
    try {
        window.dispatchEvent(new CustomEvent("ai:request-budget"));
    } catch { /* no window (tests, the harness) */ }
};

export const requestSettings = createRequestSettings();
export const requestLedger = createRequestLedger({ onChange: announce });

export const savingRequests = () => requestSettings.saveRequests();
export const backgroundAiAllowance = () => backgroundAllowance({ settings: requestSettings, ledger: requestLedger });
export const requestDay = () => describeDay({ settings: requestSettings, ledger: requestLedger });
export const announceRequestBudgetChange = announce;
