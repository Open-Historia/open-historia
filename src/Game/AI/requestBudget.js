/*! Open Historia — the request budget: how many provider requests the game spends, and on what © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The request budget, in one place (docs/ai-overview.md, "The request budget").
//
// Most players bring a free Gemini key. On that tier tokens are close to free
// and REQUESTS are what run out: a few hundred a day, a handful a minute. So
// the yardstick for every AI feature is how many requests a player action
// costs, not how long its prompt is. A time skip is ONE request, in every mode;
// function calling is what can make it more, and it is never more than
// JUMP_REQUEST_CAP. What the game spends while the player is not pressing
// anything stops at a fixed daily cap (BACKGROUND_DAILY_CAP below); there is no
// switch for it any more.
//
// Three parts, all plain data and rules:
//   - the SETTINGS a player chooses (whether their key has a request limit,
//     the limit);
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
// The most one time skip may spend, whatever the settings: the skip itself and
// two rounds of function calling.
export const JUMP_REQUEST_CAP = 3;

// "My key has no request limit" (Settings → AI → AI requests). Until the
// player sets it, it follows their main provider (the first entry of the
// Fallback list): off for Gemini, whose free key runs out of requests, on for
// any other provider (defaultNoRequestLimit). The first-run setup sets it for
// each choice, and a value the player or the setup set always wins: for a paid key or a local model, where requests do not run out and
// what each one sends is what costs. The model looks things up as it needs them
// instead of being handed everything, so a skip may ask more rounds and its
// prompt is slimmer (promptContext.js `leanLookups`). A skip is still one
// request when the model looks nothing up; with lookups it may be up to this
// many: the skip itself, six rounds of questions, and one more for being asked
// again or for upkeep. In the code the switch on is `unlimited`, and off is
// saving requests.
export const UNLIMITED_JUMP_REQUEST_CAP = 8;
// The rounds of function calling one task may ask (main.jsx runWithLookups),
// and in a skip never more than its budget has free (gameplay.js runJsonTask).
export const DEFAULT_LOOKUP_ROUNDS = 3;
export const UNLIMITED_LOOKUP_ROUNDS = 6;
export const lookupRoundLimit = ({ unlimited = false } = {}) => (unlimited ? UNLIMITED_LOOKUP_ROUNDS : DEFAULT_LOOKUP_ROUNDS);

// What a time skip may spend a request on at all (the owner's rule, 2026-10:
// "at most 3 api calls per skip, and that's for the function calling").
//
//   jump                the skip itself. ONE request: its events carry their own
//                       consequences, the Projects board, the agents' reports
//                       and, when it is due, the history document
//                       (gameplay.js, "The folded time skip"). A round of
//                       function calling it asks for is counted as jumpLookup,
//                       and being asked again, only when its first answer could
//                       not be used at all, as jumpRetry.
//   institutionBallots  NPC votes on a proposal open in an institution.
//
// Nothing else asks inside a skip. There were three more, each a request after
// the skip: the turn review (the checks, for a provider that refused the skip
// that carries them), the event consolidator (folding old events when the skip
// could not carry the fold) and the automatic Stats refresh. They are gone:
// "remove the stuff relating to those things entirely, they dont need to be
// part of the game" (the owner, 2026-11-07). A place name the map does not have
// is left out and said in the receipt (the model writes it exactly next time,
// or looks it up when function calling is on); a storyline the skip left still
// stays overdue, which is what the next skip is told to move first; with saving
// off the units, the fronts, the structures, the repeats, the board and the
// agents used to be a request each, and are the skip's own answer now.
export const SKIP_SPENDERS = Object.freeze(["jump", "institutionBallots"]);

// "jumpRetry" and "jumpLookup" are "jump" asking again and looking something up.
export const spenderBase = (spender) => String(spender || "other").replace(/(?:Retry|Lookup)$/, "") || "other";

export const REQUEST_BUDGET_KEYS = Object.freeze({
    // "My key has no request limit": "1" on, "0" off. Absent, it is read from
    // the two switches it replaced (LEGACY_REQUEST_KEYS).
    noRequestLimit: "ai_no_request_limit",
    dailyLimit: "ai_daily_request_limit",
    ledger: "ai_request_ledger",
    // What the switch changed when it was turned on, as it was before, so
    // turning it off gives the player their own choices back.
    beforeNoRequestLimit: "ai_before_no_request_limit",
});

// The two switches "My key has no request limit" replaced (2026-11-07): "Save
// AI requests", on unless turned off, and "Unlimited requests", off unless
// turned on. Read only while the new key is absent: Unlimited requests on, or
// Save AI requests off (which said it was for a key with no daily limit), is
// the switch on. Removed once the player sets the switch.
export const LEGACY_REQUEST_KEYS = Object.freeze({
    saveRequests: "ai_save_requests",
    unlimited: "ai_unlimited_requests",
});

// The AI lookup functions' own key (runtime/mapSettings.js
// MAP_SETTING_KEYS.lookupFunctions, which this module does not import): on
// unless turned off, and used only while the switch is on.
export const LOOKUP_FUNCTIONS_KEY = "ai_lookup_functions";

// There were six more, `ai_review_units` and its siblings: a switch for each
// check a time skip got after it was written. They are gone (2026-10). The
// checks are part of the skip itself now (gameplay.js, "The folded time skip"),
// so there is nothing left to switch, and a check left off only ever meant a
// map that did not match the story. A key a player once set is never read.
// So are Background AI's two, `ai_background_activity` and
// `ai_background_daily_cap` (2026-11-07): what the game does in the
// background is always on, under a cap that is fixed (BACKGROUND_DAILY_CAP).

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

const removeItem = (storage, key) => {
    try {
        storage.removeItem?.(key);
    } catch { /* refused: the key is simply left */ }
};

const wholeNumber = (value, { min, max, fallback }) => {
    const number = Math.round(Number(value));
    if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
};

// --- The settings ---

// One switch, "My key has no request limit". Everything that saves requests
// reads it: saving requests is the switch off, unlimited the switch on.
// Turning it on also turns on what a limited key does without, the AI lookup
// functions, and keeps them as they were, so turning the switch off again puts
// back what the player had chosen.
//
// Never set (the key and both switches it replaced absent), it is its default:
// on unless the player's main provider is Gemini. The default is read at every
// read, so it follows a change of main provider until the player sets it.
export const MAIN_PROVIDER_KEYS = Object.freeze({
    // providerConfig.js's Fallback list and Connections (not imported: that
    // module imports this one). The first entry whose Connection exists is
    // the main provider; before the list exists, the old api_provider.
    fallbackList: "ai_fallback_list",
    connections: "ai_connections",
    legacyProvider: "api_provider",
});
const readJsonArray = (storage, key) => {
    try {
        const value = JSON.parse(readItem(storage, key) ?? "null");
        return Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
};
export const readMainProvider = (storage = defaultStorage()) => {
    const list = readJsonArray(storage, MAIN_PROVIDER_KEYS.fallbackList);
    const connections = readJsonArray(storage, MAIN_PROVIDER_KEYS.connections);
    if (list && connections) {
        const byId = new Map(connections.filter((c) => c && typeof c === "object").map((c) => [c.id, c]));
        for (const entry of list) {
            const connection = byId.get(entry?.connectionId);
            if (connection) return String(connection.provider || "gemini").trim().toLowerCase() || "gemini";
        }
    }
    return String(readItem(storage, MAIN_PROVIDER_KEYS.legacyProvider) || "gemini").trim().toLowerCase() || "gemini";
};
export const defaultNoRequestLimit = (storage = defaultStorage()) => readMainProvider(storage) !== "gemini";

const readNoRequestLimit = (storage, { withDefault = true } = {}) => {
    const stored = readItem(storage, REQUEST_BUDGET_KEYS.noRequestLimit);
    if (stored === "1") return true;
    if (stored === "0") return false;
    const unlimited = readItem(storage, LEGACY_REQUEST_KEYS.unlimited);
    const saveRequests = readItem(storage, LEGACY_REQUEST_KEYS.saveRequests);
    if (unlimited !== null || saveRequests !== null) return unlimited === "1" || saveRequests === "0";
    return withDefault ? defaultNoRequestLimit(storage) : false;
};

// What turning the switch on sets to on.
// (It turned on Background AI too, until that went, 2026-11-07. A record of
// it kept from then is never read: only these names are put back.)
const NO_LIMIT_TURNS_ON = Object.freeze({
    lookups: LOOKUP_FUNCTIONS_KEY,
});

const readBefore = (storage) => {
    try {
        const value = JSON.parse(readItem(storage, REQUEST_BUDGET_KEYS.beforeNoRequestLimit) ?? "null");
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
};

export const createRequestSettings = ({ storage = defaultStorage() } = {}) => ({
    noRequestLimit: () => readNoRequestLimit(storage),
    saveRequests: () => !readNoRequestLimit(storage),
    unlimited: () => readNoRequestLimit(storage),
    dailyLimit: () => wholeNumber(readItem(storage, REQUEST_BUDGET_KEYS.dailyLimit), {
        min: 1, max: 1000000, fallback: DEFAULT_DAILY_REQUEST_LIMIT,
    }),
    // On: the lookup functions on, what they were kept. Off:
    // what was kept put back (null, an absent key: its default). Only a change
    // of the switch does either.
    setNoRequestLimit: (on) => {
        // What the player or the setup set, the default aside: setting it on
        // over a default that was on still turns on what it turns on.
        const was = readNoRequestLimit(storage, { withDefault: false });
        if (!writeItem(storage, REQUEST_BUDGET_KEYS.noRequestLimit, on ? "1" : "0")) return false;
        removeItem(storage, LEGACY_REQUEST_KEYS.saveRequests);
        removeItem(storage, LEGACY_REQUEST_KEYS.unlimited);
        if (on && !was) {
            const before = {};
            for (const [name, key] of Object.entries(NO_LIMIT_TURNS_ON)) {
                before[name] = readItem(storage, key);
                writeItem(storage, key, "1");
            }
            writeItem(storage, REQUEST_BUDGET_KEYS.beforeNoRequestLimit, JSON.stringify(before));
        } else if (!on && was) {
            const before = readBefore(storage) ?? {};
            for (const [name, key] of Object.entries(NO_LIMIT_TURNS_ON)) {
                if (!Object.prototype.hasOwnProperty.call(before, name)) continue;
                if (before[name] === null) removeItem(storage, key);
                else writeItem(storage, key, String(before[name]));
            }
            removeItem(storage, REQUEST_BUDGET_KEYS.beforeNoRequestLimit);
        }
        return true;
    },
    setDailyLimit: (value) => writeItem(storage, REQUEST_BUDGET_KEYS.dailyLimit,
        String(wholeNumber(value, { min: 1, max: 1000000, fallback: DEFAULT_DAILY_REQUEST_LIMIT }))),
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

// --- In the background ---
//
// Anything the game does with nobody pressing a button: a country writing to
// the player unprompted (idle diplomacy), an agent filing a report between
// skips, a first reading of an intelligence service, a stat sheet or military
// figures written ahead of the first time they are needed. There was a switch
// for all of it, Background AI, with a cap the player set, and when "My key has
// no request limit" became the default for every provider but Gemini the
// switch came on with it. "get rid of the background agent" (the owner,
// 2026-11-07): the switch is gone. What it ran stays ("dont remove idle
// diplomacy", "same with background spy stuff", "also do the intelligence
// ratings, and stats and military figures written ahead of time"), always on,
// under one fixed cap for the day, and never out of the last tenth of the
// day's limit, so the last requests of the day are always the player's own.
// With no request limit there is no allowance to keep, and only the cap
// applies.
export const BACKGROUND_DAILY_CAP = 30;
export const BACKGROUND_RESERVE_SHARE = 0.1;

export const backgroundAllowance = ({ settings, ledger }) => {
    const day = ledger.today();
    const remaining = Math.max(0, BACKGROUND_DAILY_CAP - day.background);
    if (remaining <= 0) return { allowed: false, reason: "cap", remaining: 0 };
    if (settings.noRequestLimit?.()) return { allowed: true, reason: "", remaining };
    const limit = settings.dailyLimit();
    const reserve = Math.ceil(limit * BACKGROUND_RESERVE_SHARE);
    if (day.used + reserve >= limit) return { allowed: false, reason: "reserve", remaining };
    return { allowed: true, reason: "", remaining };
};

// --- One time skip ---
//
// Who may spend is SKIP_SPENDERS above, and how much is the cap. The skip
// itself always runs: every segment's one request is reserved when the skip
// starts. Everything else asks first, and a "no" is never an error: a lookup
// round that is refused means the model answers with what it has, a refused
// retry leaves whatever the first answer can still give, and upkeep that is put
// off is due again on the next skip.

// A skip generated in segments (Settings → AI) pays one request per segment:
// the player chose that, so the cap moves with it rather than breaking the skip.
// `unlimited`: the switch is on, and the skip may look up more.
export const jumpRequestCap = ({ segments = 1, unlimited = false } = {}) => (unlimited ? UNLIMITED_JUMP_REQUEST_CAP : JUMP_REQUEST_CAP)
    + Math.max(0, Math.round(Number(segments) || 1) - 1);

// `only`: the spenders this budget serves at all (SKIP_SPENDERS for a time
// skip); null serves anyone. `state` is what `state` below gave out: a skip
// kept for its campaign (parkedTurn.js) goes on spending from the budget it
// had, after a restart too. There is no budget without a cap: the one that
// had none was for the A/B lab's runs, and went with them.
export const createJumpBudget = ({ cap = JUMP_REQUEST_CAP, only = null, state = null } = {}) => {
    const spends = (Array.isArray(state?.spends) ? state.spends : [])
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({ spender: String(entry.spender || "other"), granted: entry.granted === true, ...(entry.denied === true ? { denied: true } : {}) }));
    const reservations = new Map(Object.entries(state?.reservations && typeof state.reservations === "object" ? state.reservations : {})
        .map(([key, value]) => [key, Math.max(0, Math.round(Number(value) || 0))])
        .filter(([, value]) => value > 0));
    const limit = Math.max(1, Math.round(Number(cap) || JUMP_REQUEST_CAP));
    const served = Array.isArray(only) ? new Set(only.map((entry) => String(entry))) : null;
    const spent = () => spends.filter((entry) => entry.granted).length;
    const reserved = () => [...reservations.values()].reduce((sum, value) => sum + value, 0);
    // Is this something the budget spends on at all, whatever is left of it?
    const allows = (spender) => !served || served.has(spenderBase(spender));
    return {
        cap: limit,
        only: served ? [...served] : null,
        allows,
        // Reserve a bounded slot for correctness work that happens late in the
        // turn. Optional work asked earlier cannot consume that slot, but the
        // total request cap never increases.
        reserve: (spender, count = 1) => {
            const key = String(spender || "other");
            const wanted = Math.max(0, Math.round(Number(count) || 0));
            if (!wanted) return reservations.get(key) || 0;
            const capacity = Math.max(0, limit - spent() - reserved());
            const added = Math.min(wanted, capacity);
            if (added) reservations.set(key, (reservations.get(key) || 0) + added);
            return reservations.get(key) || 0;
        },
        // Give back a slot that was kept and turned out not to be needed, so the
        // next in line may have it (the history fold the skip's own answer
        // carried leaves its request to the Stats refresh).
        release: (spender) => {
            const key = String(spender || "other");
            const held = reservations.get(key) || 0;
            reservations.delete(key);
            return held;
        },
        // May this spender make one request? Recorded either way, so the turn's
        // log can say what was skipped to stay inside the cap, and what was not
        // asked because a skip does not spend on it.
        take: (spender) => {
            const key = String(spender || "other");
            if (!allows(key)) {
                spends.push({ spender: key, granted: false, denied: true });
                return false;
            }
            const ownReservation = reservations.get(key) || 0;
            const granted = ownReservation > 0
                ? spent() < limit
                : spent() < Math.max(0, limit - reserved());
            if (granted && ownReservation > 0) {
                if (ownReservation === 1) reservations.delete(key);
                else reservations.set(key, ownReservation - 1);
            }
            spends.push({ spender: key, granted });
            return granted;
        },
        get spent() { return spent(); },
        get remaining() { return Math.max(0, limit - spent()); },
        get reserved() { return reserved(); },
        // What anyone without a reservation could still take: the rounds of
        // function calling a task may ask (gameplay.js runJsonTask).
        get free() { return Math.max(0, limit - spent() - reserved()); },
        // Put off to stay inside the cap; and never asked, because a skip does
        // not spend on it.
        get skipped() { return spends.filter((entry) => !entry.granted && !entry.denied).map((entry) => entry.spender); },
        get denied() { return spends.filter((entry) => entry.denied).map((entry) => entry.spender); },
        get log() { return spends.map((entry) => ({ ...entry })); },
        // Plain data, for createJumpBudget's `state`.
        get state() {
            return { spends: spends.map((entry) => ({ ...entry })), reservations: Object.fromEntries(reservations) };
        },
    };
};

// A folded skip refused as a request (gameplay.js, "The folded time skip") is
// asked again the old way, and the skip asked again must have a request: the
// refused one was spent (the owner's log, 2026-11-04: "Not asked: this time
// skip has used its 3 requests", one request spent, the turn fell back). Nothing
// else is asked after a skip any more (no review, Stats refresh or history
// fold, 2026-11-07), so this keeps the skip's request and nothing else. Returns
// what it kept (1, or 0 when there was no room).
export const keepForRefusedSkip = (budget) => {
    if (!budget || typeof budget.reserve !== "function") return 0;
    // (reserve(spender, 0) reads what the spender holds: a skip in segments holds one for each segment still to come.)
    const held = budget.reserve("jump", 0);
    return budget.reserve("jump", 1) > held ? 1 : 0;
};

// What the time panel says a skip will cost before the player presses it: one
// request (one per segment), and up to the cap only when function calling may
// add rounds to it (`lookups`: the switch on, with the lookup functions on);
// the higher cap with the switch on (`unlimited`).
export const describeJumpCost = ({ lookups = false, segments = 1, unlimited = false } = {}) => {
    const pieces = Math.max(1, Math.round(Number(segments) || 1));
    return {
        min: pieces,
        max: lookups ? jumpRequestCap({ segments: pieces, unlimited }) : pieces,
        lookups: Boolean(lookups),
        rounds: lookups ? lookupRoundLimit({ unlimited }) : 0,
        unlimited: Boolean(unlimited),
    };
};

// "37 of 500 today" — and what is left, never below zero.
export const describeDay = ({ settings, ledger }) => {
    const day = ledger.today();
    const limit = settings.dailyLimit();
    return {
        used: day.used,
        limit,
        left: Math.max(0, limit - day.used),
        // No request limit: there is no day's allowance to count against.
        noLimit: Boolean(settings.noRequestLimit?.()),
        background: day.background,
        backgroundCap: BACKGROUND_DAILY_CAP,
        refused: day.refused,
        failed: day.failed,
        resetAt: day.resetAt,
        byTask: { ...day.byTask },
        lastJump: day.lastJump ? { ...day.lastJump } : null,
    };
};

// Today's requests by task, most first, for Settings → AI. `labels` names the
// task keys the caller knows ({ jumpForward: "Time skip" }); a key it does not
// is shown as it was counted, with `named: false`. Keys under one name (two
// spellings of "other") make one row.
export const requestsByTask = (byTask, labels = {}) => {
    const rows = new Map();
    for (const [key, total] of Object.entries(byTask ?? {})) {
        const count = wholeNumber(total, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
        if (!count) continue;
        const named = Object.prototype.hasOwnProperty.call(labels, key) && Boolean(labels[key]);
        const label = named ? labels[key] : key;
        const row = rows.get(label) ?? { label, named, count: 0 };
        row.count += count;
        rows.set(label, row);
    }
    return [...rows.values()].sort((a, b) => b.count - a.count || Number(b.named) - Number(a.named) || a.label.localeCompare(b.label));
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
export const unlimitedRequests = () => requestSettings.unlimited();
export const noRequestLimit = () => requestSettings.noRequestLimit();
// The switch, for Settings and the first-run setup. What it changed is told to
// whoever listens for the request budget, and for the map settings, where the
// lookup functions are.
export const setNoRequestLimit = (on) => {
    const saved = requestSettings.setNoRequestLimit(Boolean(on));
    announce();
    try {
        window.dispatchEvent(new Event("mapSettings:updated"));
    } catch { /* no window (tests, the harness) */ }
    return saved;
};
export const backgroundAiAllowance = () => backgroundAllowance({ settings: requestSettings, ledger: requestLedger });
export const requestDay = () => describeDay({ settings: requestSettings, ledger: requestLedger });
export const announceRequestBudgetChange = announce;
