/*! Open Historia — the Fallback list's rules: which model answers, and when one is skipped © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Fallback list's rules, in one place (docs/world-state.md, "AI access").
//
// Every AI call starts at the top of the player's Fallback list and uses the
// first entry that can answer. It moves down only when an entry cannot: it is
// Spent, Unusable, or busy for a moment. It never spreads calls across entries
// to get more usage — see docs/adr/0001-fallback-never-rotation.md before
// changing anything about the order.
//
// And every call starts at the top again (2026-09-19): an entry that failed a
// moment ago is still tried first next time, because a rate limit or a busy
// spell is usually over by then, and a call that skipped it would run on a
// weaker model for nothing. The marks a failure leaves are kept — the Settings
// rows show them, and a call that finds every entry failing says when the
// first comes back — but they never take an entry out of the order.
//
// DELIBERATELY IMPORT-FREE, like providerErrors.js: main.jsx makes the calls and
// cannot be unit-tested, and these rules are exactly what needs to be. The
// caller hands in the list, where entry states are kept, a clock, and one
// function that makes one call on one entry.

// Remembers entry states in memory, for the tests. The game keeps the real one
// in localStorage (providerConfig.js fallbackStateStore); both have this shape.
export const createMemoryStateStore = (initial = {}) => {
    const states = new Map(Object.entries(initial));
    return {
        get: (id) => states.get(id),
        set: (id, state) => { states.set(id, state); },
    };
};

const HOUR_MS = 60 * 60 * 1000;

// The Pacific wall clock at an instant, from the platform's own time-zone data,
// so the change to and from daylight saving is right without a table here.
let pacificFormat = null;
const pacificWallClockMs = (at) => {
    pacificFormat ??= new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const part = Object.fromEntries(pacificFormat.formatToParts(new Date(at)).map(({ type, value }) => [type, Number(value)]));
    return Date.UTC(part.year, part.month - 1, part.day, part.hour % 24, part.minute, part.second);
};

// Google resets the Gemini free tier at midnight Pacific time.
export const nextPacificMidnight = (at) => {
    try {
        const offsetAt = (instant) => pacificWallClockMs(instant) - Math.floor(instant / 1000) * 1000;
        const wall = new Date(pacificWallClockMs(at));
        const midnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
        // The offset at midnight can differ from the offset now (a change of
        // clocks in between), so settle it at the answer itself.
        const guess = midnightWall - offsetAt(at);
        return midnightWall - offsetAt(guess);
    } catch {
        // No time-zone data: midnight at UTC-8 is at worst an hour out.
        const day = 24 * HOUR_MS;
        return Math.floor((at - 8 * HOUR_MS) / day) * day + day + 8 * HOUR_MS;
    }
};

// When a Spent entry gets its next try. Other providers do not say when they
// reset, so an hour on, one request finds out.
const spentUntil = (entry, at) => (entry.provider === "gemini" ? nextPacificMidnight(at) : at + HOUR_MS);

// A busy or Rate limited entry sits out this long unless the provider said.
export const SHORT_SKIP_MS = 60 * 1000;

// Spent and Unusable are hard: the entry cannot answer. A short skip is only
// advice about where to START — see orderToTry.
const isAvailable = (state, at) => !state || (!state.unusable && !(state.spentUntil > at));
const isSkipped = (state, at) => Boolean(state && state.skipUntil > at);

// The mark a failure leaves on its entry, or null when the failure says nothing
// about the entry and the call should fail as it always did.
const markFor = (entry, failure, at, rateLimitPolicy) => {
    switch (failure?.kind) {
    case "spent": return { spentUntil: spentUntil(entry, at) };
    case "unusable": return { unusable: failure.reason || "failed" };
    case "busy": return { skipUntil: at + SHORT_SKIP_MS, skipReason: "busy" };
    // On "wait" the provider has already waited as long as it was going to;
    // moving on would spend the backups' allowance on a minute's pause.
    case "rateLimited": return rateLimitPolicy === "next"
        ? { skipUntil: at + (Number(failure.waitMs) > 0 ? Number(failure.waitMs) : SHORT_SKIP_MS), skipReason: "rate limited" }
        : null;
    default: return null;
    }
};

// Every entry, in list order, whatever its mark: a task's own pick first, the
// rest from the top.
const orderToTry = (entries, preferredEntryId) => {
    const pick = entries.find((candidate) => candidate.id === preferredEntryId);
    return pick ? [pick, ...entries.filter((candidate) => candidate !== pick)] : [...entries];
};

// What a Settings row says about its entry: ready, Spent (until when),
// Unusable (and why), or busy (back when), and when it last answered.
export const entryStatus = (state, at) => {
    const lastAnsweredAt = Number.isFinite(state?.lastAnsweredAt) ? state.lastAnsweredAt : null;
    if (state?.unusable) return { status: "unusable", reason: state.unusable, until: null, lastAnsweredAt };
    if (state?.spentUntil > at) return { status: "spent", reason: "", until: state.spentUntil, lastAnsweredAt };
    if (state?.skipUntil > at) return { status: "busy", reason: state.skipReason || "busy", until: state.skipUntil, lastAnsweredAt };
    return { status: "ready", reason: "", until: null, lastAnsweredAt };
};

// Can anything in the list answer right now, and if not, what comes back first?
// Asked before a time skip starts, so a turn is not spent finding out.
export const fallbackAvailability = ({ entries, store, now = Date.now }) => {
    const at = now();
    if (entries.some((candidate) => isAvailable(store.get(candidate.id), at))) {
        return { canAnswer: true, nextResetAt: null, nextEntry: null };
    }
    let nextEntry = null;
    let nextResetAt = null;
    for (const candidate of entries) {
        const until = store.get(candidate.id)?.spentUntil;
        if (Number.isFinite(until) && !store.get(candidate.id)?.unusable && (nextResetAt === null || until < nextResetAt)) {
            nextResetAt = until;
            nextEntry = candidate;
        }
    }
    return { canAnswer: false, nextResetAt, nextEntry };
};

// How a reset time is shown to the player: the clock time, in their own
// format. Shared by every message that says when a model comes back.
export const formatResetTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// What to tell the player when nothing in the list can answer: when the first
// Spent entry comes back, or what is wrong with the first Unusable one. The
// runner's error says it, and so does the time-skip gate before a turn starts.
export const describeUnavailable = ({ entries, store, now = Date.now, formatTime = formatResetTime }) => {
    const { nextResetAt, nextEntry } = fallbackAvailability({ entries, store, now });
    const unusable = entries.find((candidate) => store.get(candidate.id)?.unusable);
    if (nextEntry) return `Every model in your Fallback list has used its allowance for now. The first back is ${nextEntry.label}, at ${formatTime(nextResetAt)}.`;
    if (unusable) return `No model in your Fallback list can answer. ${unusable.label}: ${store.get(unusable.id).unusable}. Fix it in Settings → AI.`;
    return "No model in your Fallback list can answer. Add one in Settings → AI.";
};

// The error for a call that found nothing in the list able to answer. Carries
// `fallbackUnavailable` so the UI can tell it from an ordinary failure.
const unavailableError = (entries, store, now, formatTime, cause) => {
    const { nextResetAt, nextEntry } = fallbackAvailability({ entries, store, now });
    const error = new Error(describeUnavailable({ entries, store, now, formatTime }), cause ? { cause } : undefined);
    error.fallbackUnavailable = { nextResetAt, nextEntry };
    return error;
};

// `onMark` hears every mark (the Diagnostics log wants each one). `onSwitch`
// hears the entries THIS call found unable to answer on its way down — only
// those it marked itself, so two calls of one turn that both hit the same Spent
// entry tell the player once, not twice. It hears them whether the call then
// got an answer (`to` is the entry that gave it) or not (`to` is null): either
// way the calls after it start further down, and the player should know why.
//
// `canAttempt(entry)` is asked before each entry is tried: a reason (a string)
// means THIS request must not go to that entry — it cannot fit the model's
// context window (contextWindow.js) — and the runner moves on without sending
// anything, exactly as it would after the provider had refused it. The entry is
// not marked: it is the request that is too big, not the entry that is broken,
// and the next request may fit. When every entry is refused this way the call
// fails with `tooBigError(refused)` before a single request is spent.
export async function runWithFallback({
    entries,
    preferredEntryId,
    store,
    now = Date.now,
    rateLimitPolicy = "next",
    onChunk,
    attempt,
    canAttempt = null,
    tooBigError = null,
    onMark,
    onSwitch,
    formatTime = formatResetTime,
}) {
    let lastError = null;
    const skipped = [];
    const refused = [];
    const fail = (error) => {
        if (skipped.length) onSwitch?.({ skipped, to: null });
        return error;
    };
    const order = orderToTry(entries, preferredEntryId);
    if (!order.length) throw unavailableError(entries, store, now, formatTime, null);
    let tried = 0;
    for (const [index, candidate] of order.entries()) {
        const refusal = typeof canAttempt === "function" ? canAttempt(candidate) : "";
        if (refusal) {
            const failure = { kind: "tooBig", reason: String(refusal) };
            refused.push({ entry: candidate, reason: String(refusal) });
            skipped.push({ entry: candidate, failure });
            onMark?.({ entry: candidate, failure, state: null });
            continue;
        }
        tried += 1;
        // Once any of a streamed reply has reached the player, a failure is
        // theirs to retry: a different model picking the reply up halfway
        // through would read as a glitch.
        let answerStarted = false;
        const context = {
            // Whether anything is left after this entry. With a backup, a busy
            // or rate-limited entry hands over at once; the last one keeps its
            // full retries (shouldRetryProviderFailure).
            canFallBack: index < order.length - 1,
            onChunk: typeof onChunk === "function"
                ? (delta, full) => { answerStarted = true; onChunk(delta, full); }
                : undefined,
        };
        try {
            const result = await attempt(candidate, context);
            // It answered, so whatever it was waiting out is over.
            store.set(candidate.id, { lastAnsweredAt: now() });
            if (skipped.length) onSwitch?.({ skipped, to: candidate });
            return { result, entry: candidate };
        } catch (error) {
            const failure = error?.providerFailure;
            // The model refused the request as too big for its window. Not a
            // mark on the entry (the next request may fit), but a reason to try
            // the next entry, whose window may be larger.
            if (failure?.kind === "tooBig" && !answerStarted) {
                refused.push({ entry: candidate, reason: failure.reason || "too big for its context window" });
                skipped.push({ entry: candidate, failure });
                onMark?.({ entry: candidate, failure, state: null });
                lastError = error;
                continue;
            }
            const mark = markFor(candidate, failure, now(), rateLimitPolicy);
            if (mark) {
                const before = store.get(candidate.id);
                // Another call of the same turn may have got there first.
                const alreadyMarked = !isAvailable(before, now()) || isSkipped(before, now());
                store.set(candidate.id, { ...before, ...mark });
                if (!alreadyMarked) {
                    skipped.push({ entry: candidate, failure });
                    onMark?.({ entry: candidate, failure, state: mark });
                }
            }
            if (!mark || answerStarted) throw fail(error);
            lastError = error;
        }
    }
    // Nothing was even sent: every entry was refused for size before the call.
    if (!tried && refused.length && typeof tooBigError === "function") throw fail(tooBigError(refused));
    // Everything is Spent or Unusable: say when the list comes back. When the
    // last hope was only busy, its own message says that better.
    if (!fallbackAvailability({ entries, store, now }).canAnswer) throw fail(unavailableError(entries, store, now, formatTime, lastError));
    // The last thing that went wrong: for a request refused everywhere for its
    // size, the provider's own context-window message.
    throw fail(lastError ?? (typeof tooBigError === "function" && refused.length ? tooBigError(refused) : new Error("No model in your Fallback list answered.")));
}