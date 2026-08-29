/*! Open Historia — in-game diagnostics log © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The log a player can paste into a bug report.
//
// Before this, the only diagnostics the game could hand out were per-incident:
// the advisor's "Copy for a bug report" and the timeline's "Copy debugging
// message" (time.jsx), both of which describe ONE failed AI turn and nothing
// around it. That is the wrong shape for most reports, which are of the form
// "I loaded this save, queued these actions, jumped twice and the border went
// wrong" — a SEQUENCE. The packaged desktop app binds no developer tools (no
// F12, no menu entry), so the console those steps were already being written to
// was unreachable, and asking a player to reproduce a bug with DevTools open is
// asking most players for nothing.
//
// So: a rolling buffer of what happened, kept in memory, mirrored to
// localStorage so it survives the reload after a crash, and emitted as one
// plain-text report behind a Copy button and a Download button in
// Settings → Diagnostics.
//
// WHAT GOES IN. Two sources:
//   1. Explicit logDebugEvent() calls at the milestones a report needs — game
//      loaded/saved, turn started/finished/fell back, action queued, rollback,
//      provider changed, settings toggled.
//   2. Every console.warn / console.error the game already writes, plus
//      uncaught errors and unhandled promise rejections, captured by
//      installDebugLogCapture(). The codebase logs its failures diligently
//      ("[actions] could not revert the unit order", "Failed to save actions")
//      and that is exactly the material a report needs, so it is collected
//      rather than duplicated by hand at every call site.
//
// WHAT NEVER GOES IN. API keys. Nothing here reads a key deliberately, but a
// key can arrive by accident inside a provider error, a URL or a stringified
// request, so redactSecrets() below is a second line of defence run over every
// entry as it is recorded — not at export time, so a key is never even held in
// the buffer. See that function for what it catches.
//
// Campaign text is kept short on purpose: titles, counts and ids, not event
// prose or chat bodies. A log a player is willing to paste in public is worth
// more than a complete one they are not.
//
// TWO SWITCHES, both in Settings → Diagnostics and both persisted in
// localStorage so they survive closing the app and switching campaigns:
//
//   * Logging (default ON). Off means nothing is recorded and the stored log is
//     thrown away. Checked at the top of logDebugEvent so a disabled log costs
//     the game nothing beyond a boolean test.
//   * Detailed logging (default OFF). Adds the entries marked `{ verbose: true }`
//     at their call sites — every AI task and API call rather than only the
//     failures, world-state changes turn by turn, panel navigation, console.log
//     chatter — and keeps far more of each one (longer details, deeper stacks).
//     It is off by default because it is heavier and quotes more of the
//     campaign, and on when a maintainer asks for it.
//
// The buffer is bounded by SIZE, not only by entry count, and drops its oldest
// entries to stay there — see trimToBudget.

// Two ceilings, and the size one is the one that really governs.
//
// MAX_ENTRIES stops a quiet session growing without bound; MAX_LOG_CHARS is what
// keeps the log inside the storage it has to live in. Detailed mode raises the
// entry ceiling because its entries are both more numerous and individually
// larger — but it does NOT raise the size budget, so a detailed log simply holds
// less history in the same space. That is the honest trade and the panel shows
// the size so a player can see it.
const MAX_ENTRIES = 400;
const MAX_ENTRIES_VERBOSE = 2500;
// localStorage is a ~5 MB budget shared with the translator cache, the flag
// library and every setting. The log is the least important thing in it.
const MAX_LOG_CHARS = 192 * 1024;
const MAX_DETAIL_CHARS = 600;
// Detailed mode keeps far more of each detail: a truncated stack trace or a
// clipped raw model response is usually worth nothing at all, and the whole
// point of turning it on is to stop losing them.
const MAX_DETAIL_CHARS_VERBOSE = 6000;
// Frames of an Error's stack. One is where it threw, which is all a normal log
// needs; the rest is React internals nine times out of ten. Detailed mode keeps
// enough to actually walk a call path.
const STACK_FRAMES = 1;
const STACK_FRAMES_VERBOSE = 8;
// Repeat collapsing. A failing basemap host or a dead content node produces the
// same fetch error dozens of times a second, and left alone one bad tile URL
// evicts the entire campaign from a 400-entry buffer — the exact entries the log
// exists for. So an entry identical to a recent one bumps that entry's counter
// instead of appending.
//
// Scanned over a WINDOW of recent entries rather than only the previous one,
// because storms interleave: maplibre's AJAXError and our own fetch rejection
// alternate, so consecutive-only matching would collapse neither. The time limit
// keeps the same message an hour apart as two events, which is what it is.
const COALESCE_WINDOW = 25;
const COALESCE_MS = 60_000;
const STORAGE_KEY = "oh_debug_log_v1";
// A backstop on the serialized form only. The real trimming happens against
// MAX_LOG_CHARS as entries are recorded; this catches the case where the JSON
// scaffolding costs more than the estimate below assumed.
const MAX_STORED_CHARS = 224 * 1024;
const PERSIST_DEBOUNCE_MS = 800;

// Both settings persist in localStorage, which is what makes the choice survive
// closing the app: the desktop build keeps its Chromium profile between runs, so
// a player who turns logging off finds it still off tomorrow, next campaign, and
// after switching saves. Neither is stored in a save file — the choice is about
// this installation, not this campaign, and a save copied between machines
// should not carry someone else's logging preference with it.
//
// Absent means DEFAULT, and the two defaults differ, so the two keys read
// differently on purpose: logging is on unless explicitly "0", detail is off
// unless explicitly "1".
const ENABLED_STORAGE_KEY = "oh_debug_log_enabled";
const VERBOSE_STORAGE_KEY = "oh_debug_log_verbose";

let entries = [];
let sequence = 0;
let context = {};
let persistTimer = null;
let captureInstalled = false;
// Running total of what entries[] costs, maintained incrementally rather than
// recomputed: trimming has to run on every single entry, and re-measuring a
// 2500-entry buffer each time is exactly the kind of work that turns a bad
// network into a frame-rate problem.
let usedChars = 0;
// How many entries the size cap has thrown away this session. Reported, because
// "the log starts at 11:42 with no explanation" and "the log dropped its first
// 900 entries to stay under the cap" are very different things to a reader.
let droppedEntries = 0;
const listeners = new Set();

// ---------------------------------------------------------------------------
// Settings — on/off and detailed, both persisted
// ---------------------------------------------------------------------------

// Cached rather than read from localStorage per entry: logDebugEvent runs in the
// hot path of a turn and every console call the game makes. The cache is written
// through by the setters below, and primed at module load so the very first
// entry — logged from src/main.jsx before anything mounts — already obeys a
// player's saved choice.
let loggingEnabled = true;
let verboseLogging = false;

const readStoredFlag = (key, fallback) => {
    if (typeof localStorage === "undefined") return fallback;
    try {
        const stored = localStorage.getItem(key);
        return stored === null ? fallback : stored === "1";
    } catch {
        return fallback;
    }
};

const writeStoredFlag = (key, value) => {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(key, value ? "1" : "0");
    } catch { /* storage disabled — the choice holds for this session only */ }
};

loggingEnabled = readStoredFlag(ENABLED_STORAGE_KEY, true);
verboseLogging = readStoredFlag(VERBOSE_STORAGE_KEY, false);

export const isDebugLogEnabled = () => loggingEnabled;
export const isDebugLogVerbose = () => verboseLogging;

const maxEntries = () => (verboseLogging ? MAX_ENTRIES_VERBOSE : MAX_ENTRIES);
const detailLimit = () => (verboseLogging ? MAX_DETAIL_CHARS_VERBOSE : MAX_DETAIL_CHARS);
const stackFrames = () => (verboseLogging ? STACK_FRAMES_VERBOSE : STACK_FRAMES);

// Turning logging OFF also throws away what has been collected, and the toggle's
// helper text says so. A player who switches this off is saying they would
// rather the game did not keep this; leaving the last session's log sitting in
// storage would ignore half of that, and it would go on occupying the storage
// budget for a feature they just declined.
export const setDebugLogEnabled = (enabled) => {
    const next = Boolean(enabled);
    if (next === loggingEnabled) return;
    loggingEnabled = next;
    writeStoredFlag(ENABLED_STORAGE_KEY, next);

    if (next) {
        logDebugEvent("setting", "Diagnostics logging turned on.");
    } else {
        entries = [];
        usedChars = 0;
        droppedEntries = 0;
        try {
            localStorage?.removeItem(STORAGE_KEY);
        } catch { /* storage disabled — the in-memory clear is what mattered */ }
        emit();
    }
};

export const setDebugLogVerbose = (verbose) => {
    const next = Boolean(verbose);
    if (next === verboseLogging) return;
    verboseLogging = next;
    writeStoredFlag(VERBOSE_STORAGE_KEY, next);
    // Logged from inside the new mode, so the line itself marks where the extra
    // material starts (or stops) for whoever reads the log later.
    logDebugEvent("setting", next
        ? "Detailed logging turned ON — extra AI, API and world-state entries follow."
        : "Detailed logging turned off.");
    // Leaving detailed mode drops the entry ceiling; trim to it now rather than
    // leaving the buffer over its limit until the next entry happens to arrive.
    trimToBudget();
    emit();
};

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

// Every provider key this device has stored, read live from localStorage.
//
// Pattern matching alone is not enough — a self-hosted gateway's key can be any
// string at all ("hunter2" is a valid Ollama key), and no regex finds that. But
// we know exactly what the keys ARE, because the game stored them: every
// provider registers its key under a `*_api_key` localStorage key
// (Game/AI/providerConfig.js). So the strongest pass is a literal search for
// those values. Read fresh each time rather than cached, so a key pasted into
// Settings mid-session is redacted from the very next entry.
//
// Matched by suffix rather than against a fixed list so a provider added later
// is covered without anyone remembering to come back here.
const storedSecretValues = () => {
    if (typeof localStorage === "undefined") return [];
    const values = [];
    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key || !/(_api_key|_token|_secret)$/i.test(key)) continue;
            const value = localStorage.getItem(key);
            // Very short values are not keys and would redact half the log if
            // treated as one (a stray "1" would eat every number in it).
            if (typeof value === "string" && value.trim().length >= 8) values.push(value.trim());
        }
    } catch { /* storage disabled — fall through to the patterns below */ }
    return values;
};

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Shapes that are a credential wherever they appear, for the cases the literal
// pass cannot reach: a key the player typed into a chat, one embedded in a
// pasted URL, or one belonging to a provider whose value is not in this
// device's storage (a LAN client reporting on the host's behalf).
const SECRET_PATTERNS = [
    // Vendor-prefixed keys: OpenAI sk-…, Anthropic sk-ant-…, Google AIza…,
    // OpenRouter sk-or-…, HuggingFace hf_…, Groq gsk_….
    [/\bsk-[A-Za-z0-9_-]{12,}/g, "[redacted key]"],
    [/\bAIza[A-Za-z0-9_-]{20,}/g, "[redacted key]"],
    [/\b(?:hf_|gsk_|xai-)[A-Za-z0-9_-]{12,}/g, "[redacted key]"],
    // Authorization headers, however they were stringified.
    [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[redacted authorization]"],
    // key=… / api_key: "…" / "authorization": "…" in a URL or a dumped object.
    [/((?:api[-_]?key|access[-_]?token|auth[-_]?token|authorization|password)["'\s]*[:=]["'\s]*)([^"'\s,&}]{6,})/gi, "$1[redacted]"],
    // Credentials in a URL's userinfo (http://user:pass@host).
    [/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi, "$1[redacted]@"],
    // A JWT, whatever it is carrying.
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[redacted token]"],
];

// Run over every entry as it is recorded. Deliberately blunt: over-redacting
// costs a reader a little context, under-redacting publishes a player's key.
export const redactSecrets = (value) => {
    let text = String(value ?? "");
    if (!text) return text;

    for (const secret of storedSecretValues()) {
        text = text.replace(new RegExp(escapeForRegExp(secret), "g"), "[redacted API key]");
    }
    for (const [pattern, replacement] of SECRET_PATTERNS) {
        text = text.replace(pattern, replacement);
    }
    return text;
};

// ---------------------------------------------------------------------------
// The buffer
// ---------------------------------------------------------------------------

const emit = () => {
    for (const listener of listeners) listener();
};

// Anything can be handed to a log call — an Error, a DOM event, a response
// object, a bare string. Flatten it to one short line, keeping the parts a
// reader needs (an Error's name/message, an object's own fields) and dropping
// the rest, so one enormous stringified world state cannot fill the buffer.
const describeDetail = (detail) => {
    if (detail === null || detail === undefined) return "";
    if (typeof detail === "string") return detail;
    if (typeof detail === "number" || typeof detail === "boolean") return String(detail);
    if (detail instanceof Error) {
        const frames = String(detail.stack || "")
            .split("\n")
            .slice(1, 1 + stackFrames())
            .map((line) => line.trim())
            .filter(Boolean);
        if (!frames.length) return `${detail.name}: ${detail.message}`;
        // One frame reads better inline; a detailed-mode stack needs its own
        // lines or it is unreadable in a pasted report.
        return frames.length === 1
            ? `${detail.name}: ${detail.message} (${frames[0]})`
            : `${detail.name}: ${detail.message}\n${frames.map((frame) => `          ${frame}`).join("\n")}`;
    }
    if (Array.isArray(detail)) return detail.map(describeDetail).filter(Boolean).join(" ");
    try {
        return JSON.stringify(detail);
    } catch {
        // Circular, or a proxy that throws on access — both happen with DOM
        // objects, and neither is a reason to lose the entry.
        return String(detail);
    }
};

const truncate = (text, limit = detailLimit()) =>
    text.length > limit ? `${text.slice(0, limit)}… (+${text.length - limit} chars)` : text;

// What one entry costs against MAX_LOG_CHARS. The constant is the JSON
// scaffolding — the field names, the two ISO timestamps, the punctuation — which
// is a fixed ~110 characters per entry and dominates a short message, so
// ignoring it would let a flood of one-word entries blow through the budget.
const entryCost = (entry) =>
    120 + entry.message.length + entry.detail.length + entry.category.length + entry.gameDate.length;

// Drop the OLDEST entries until the buffer is inside both ceilings.
//
// Oldest-first is the only sensible direction: a report is read for what led up
// to the problem, and the problem is at the end. Dropped one at a time rather
// than by halves so a log at the cap keeps as much history as it can hold — the
// earlier "slice off half" behaviour threw away up to 200 entries the moment the
// buffer filled, most of which there was still room for.
function trimToBudget() {
    const entryCeiling = maxEntries();
    let dropped = 0;
    while (entries.length > 1 && (entries.length > entryCeiling || usedChars > MAX_LOG_CHARS)) {
        usedChars -= entryCost(entries[0]);
        entries.shift();
        dropped += 1;
    }
    if (dropped) droppedEntries += dropped;
    return dropped;
}

// The one way anything gets into the log.
//
// `category` is a short tag the reader scans down the left margin ("game",
// "turn", "ai", "action", "error"). `message` is what happened, in the past
// tense. `detail` is optional and gets flattened and truncated.
export const logDebugEvent = (category, message, detail, { verbose = false } = {}) => {
    // Both gates first, before any of the work below: a disabled log must cost
    // nothing at all, and a verbose-only entry must cost nothing while detailed
    // mode is off. Every call site can then log unconditionally and let this
    // decide, which is why the verbose hooks throughout the game are written as
    // plain calls rather than wrapped in `if` statements that could drift.
    if (!loggingEnabled) return;
    if (verbose && !verboseLogging) return;

    const flatDetail = truncate(describeDetail(detail));
    const safeCategory = redactSecrets(category || "app");
    const safeMessage = redactSecrets(message);
    const safeDetail = flatDetail ? redactSecrets(flatDetail) : "";
    const now = Date.now();

    for (let index = entries.length - 1; index >= Math.max(0, entries.length - COALESCE_WINDOW); index -= 1) {
        const candidate = entries[index];
        if (candidate.category !== safeCategory || candidate.message !== safeMessage || candidate.detail !== safeDetail) continue;
        if (now - Date.parse(candidate.lastAt || candidate.at) > COALESCE_MS) break;
        candidate.repeat = (candidate.repeat || 1) + 1;
        candidate.lastAt = new Date(now).toISOString();
        schedulePersist();
        emit();
        return;

    }

    sequence += 1;
    entries.push({
        seq: sequence,
        at: new Date(now).toISOString(),
        // Real-world time answers "how long did that turn take"; the in-game
        // date answers "where in the campaign was this", and a bug report needs
        // both. Kept per-entry rather than only in the header because the game
        // date moves as the log is being written.
        gameDate: context.gameDate || "",
        category: safeCategory,
        message: safeMessage,
        detail: safeDetail,
    });
    usedChars += entryCost(entries[entries.length - 1]);
    trimToBudget();
    schedulePersist();
    emit();
};

// Campaign context for the report header, set by whoever knows it: library.js
// when the active game changes, time.jsx as the date advances. Merged rather
// than replaced so no caller has to know the other callers' fields.
export const setDebugLogContext = (patch = {}) => {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
        const next = redactSecrets(value ?? "");
        if (context[key] !== next) {
            context[key] = next;
            changed = true;
        }
    }
    if (changed) schedulePersist();
};

export const getDebugLogContext = () => ({ ...context });
export const getDebugLogEntries = () => entries.slice();
export const getDebugLogSize = () => entries.length;
// Shown in the settings panel beside the count. The cap is invisible otherwise —
// a player watching "400 entries" sit still has no way to tell a quiet game from
// a log that is silently rolling over.
export const getDebugLogBytes = () => usedChars;
export const getDebugLogLimitBytes = () => MAX_LOG_CHARS;
export const getDebugLogDroppedCount = () => droppedEntries;

// `silent` exists for the tests, which need a genuinely empty buffer to count
// entries in. The player-facing path always leaves the note: a log that jumps
// from boot to mid-campaign with no explanation reads like lost entries, and a
// reader chasing a phantom gap is worse off than one told there is none.
export const clearDebugLog = ({ silent = false } = {}) => {
    entries = [];
    usedChars = 0;
    droppedEntries = 0;
    try {
        localStorage?.removeItem(STORAGE_KEY);
    } catch { /* storage disabled — the in-memory clear is what mattered */ }
    if (!silent) logDebugEvent("app", "Diagnostics log cleared by the player.");
};

export const subscribeToDebugLog = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
//
// The whole point of the log is the crash that killed the page, and an
// in-memory buffer dies with it. So it is mirrored to localStorage — debounced,
// because a busy turn logs a dozen entries a second and a synchronous write per
// entry is a jank source, and flushed on pagehide so the last entries before a
// reload or a close are not the ones that are lost.

const persistNow = () => {
    persistTimer = null;
    if (typeof localStorage === "undefined") return;
    // Nothing is written while logging is off — the disable path already removed
    // the key, and a stray flush (pagehide, the error boundary) must not put it
    // back after the player said no.
    if (!loggingEnabled) return;
    try {
        let payload = JSON.stringify({ version: 1, context, entries });
        // Backstop for the estimate in entryCost: if the serialized form is still
        // too big, drop the oldest tenth and re-measure until it fits. In tenths
        // rather than one at a time because each pass re-serializes the whole
        // buffer, and in tenths rather than halves because halves threw away far
        // more history than the overrun called for.
        while (payload.length > MAX_STORED_CHARS && entries.length > 1) {
            const surplus = Math.max(1, Math.ceil(entries.length / 10));
            for (let index = 0; index < surplus && entries.length > 1; index += 1) {
                usedChars -= entryCost(entries[0]);
                entries.shift();
                droppedEntries += 1;
            }
            payload = JSON.stringify({ version: 1, context, entries });
        }
        localStorage.setItem(STORAGE_KEY, payload);
    } catch {
        // Quota exceeded, private mode, or storage disabled. The log is a
        // convenience; nothing here is worth breaking the game over, and the
        // in-memory buffer still serves the session that is running.
    }
};

function schedulePersist() {
    if (typeof localStorage === "undefined") return;
    if (persistTimer !== null) return;
    persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
}

export const flushDebugLog = () => {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistNow();
};

// Restores the previous session's entries so the report covers the run that
// crashed as well as the one reading it. Marked with a separator rather than
// silently concatenated — "this is where the page reloaded" is often the single
// most informative line in the whole log.
const restorePersisted = () => {
    if (typeof localStorage === "undefined") return;
    let stored = null;
    try {
        stored = localStorage.getItem(STORAGE_KEY);
    } catch { return; }
    if (!stored) return;
    try {
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed?.entries)) return;
        // Normalized on the way in: an entry written by an earlier build has no
        // repeat/lastAt, and entryCost would read undefined lengths off one that
        // is missing a field entirely.
        entries = parsed.entries
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => ({
                seq: Number(entry.seq) || 0,
                at: String(entry.at || ""),
                lastAt: entry.lastAt ? String(entry.lastAt) : undefined,
                repeat: Number(entry.repeat) || 1,
                gameDate: String(entry.gameDate || ""),
                category: String(entry.category || "app"),
                message: String(entry.message || ""),
                detail: String(entry.detail || ""),
            }));
        usedChars = entries.reduce((total, entry) => total + entryCost(entry), 0);
        // The restored buffer can exceed today's ceilings — it was written while
        // detailed mode was on, or by a build with a larger cap.
        trimToBudget();
        sequence = entries.length ? Number(entries[entries.length - 1]?.seq) || entries.length : 0;
        if (parsed.context && typeof parsed.context === "object") context = { ...parsed.context };
    } catch {
        // Truncated or written by an older build — start clean rather than
        // showing half an entry.
        entries = [];
        usedChars = 0;
    }
};

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

// Wraps console.warn/error and the two global error hooks, and restores the
// previous session's buffer. Called once at boot (src/main.jsx).
//
// The original console methods are still called — the log is an addition, not a
// replacement, and a developer with DevTools open must see exactly what they
// saw before. Reentrancy is guarded because logDebugEvent's own failure path
// would otherwise console.warn its way into an infinite loop.
export const installDebugLogCapture = () => {
    if (captureInstalled) return;
    captureInstalled = true;

    if (loggingEnabled) {
        restorePersisted();
        if (entries.length) {
            logDebugEvent("app", "— page reloaded; entries above are from the previous session —");
        }
    } else {
        // Logging was turned off in an earlier run. Nothing is restored and
        // nothing will be recorded until the player turns it back on; the
        // wrappers below still go in, because they check the flag per call and
        // a mid-session re-enable has to start working immediately.
        try {
            localStorage?.removeItem(STORAGE_KEY);
        } catch { /* storage disabled */ }
    }

    if (typeof console !== "undefined") {
        let inside = false;
        // warn/error always; log/info only while detailed mode is on. console.log
        // is where the game's routine chatter goes, which is noise in a normal
        // report and exactly the running commentary a detailed one wants.
        const wrapped = [
            ["warn", "warn", false],
            ["error", "error", false],
            ["log", "log", true],
            ["info", "log", true],
        ];
        for (const [method, category, verbose] of wrapped) {
            const original = console[method]?.bind(console);
            if (!original) continue;
            console[method] = (...args) => {
                original(...args);
                if (inside) return;
                inside = true;
                try {
                    const [first, ...rest] = args;
                    logDebugEvent(category, describeDetail(first), rest.length ? rest : undefined, { verbose });
                } catch { /* never let logging break a console call */ }
                inside = false;
            };
        }
    }

    if (typeof window !== "undefined") {
        window.addEventListener("error", (event) => {
            // A failed <img>/<script> load fires here too with no error object;
            // those are noise next to a real throw, so name them differently.
            if (event?.error) {
                logDebugEvent("crash", "Uncaught error", event.error);
            } else if (event?.message) {
                logDebugEvent("crash", "Uncaught error", `${event.message} (${event.filename || "unknown file"}:${event.lineno || 0})`);
            }
        });
        window.addEventListener("unhandledrejection", (event) => {
            logDebugEvent("crash", "Unhandled promise rejection", event?.reason);
        });
        // Last chance to write: pagehide fires on reload, navigation and tab
        // close, including the mobile cases where unload never does.
        window.addEventListener("pagehide", flushDebugLog);
    }
};

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const contextLine = (label, value) => (value ? `${label}: ${value}` : "");

// "0 KB" beside a live entry count reads like a broken counter, which is the one
// thing this line must never look like — it is also how a player checks the log
// is recording at all.
export const formatLogSize = (chars) => (chars < 1024 ? "<1 KB" : `${Math.round(chars / 1024)} KB`);

// Everything the player pastes, as one plain-text block: a header saying what
// build and what campaign this is, then the entries oldest-first.
//
// Plain text, not JSON — it is going into a Discord message or a GitHub issue,
// where a human reads it and a code fence is the only formatting available.
export const buildDebugLogReport = () => {
    const header = [
        "OPEN HISTORIA — DIAGNOSTICS LOG",
        `Generated: ${new Date().toISOString()}`,
        contextLine("Build", context.build),
        contextLine("Platform", typeof navigator !== "undefined" ? navigator.userAgent : ""),
        contextLine("Language", context.language),
        contextLine("Screen", typeof window !== "undefined" && window.screen
            ? `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio || 1}x`
            : ""),
        "",
        contextLine("Game", context.gameName),
        contextLine("Game id", context.gameId),
        contextLine("Scenario", context.scenario),
        contextLine("Player polity", context.playerCountry),
        contextLine("Game date", context.gameDate),
        contextLine("Round", context.round),
        contextLine("Difficulty", context.difficulty),
        "",
        // Provider and model NAMES only. Which model a player is on is the
        // single most useful line in an AI bug report, and it is not a secret;
        // the key that reaches it is, and never appears here.
        contextLine("AI provider", context.provider),
        contextLine("AI model", context.model),
        contextLine("Unit system", context.unitSystem),
        // Stated rather than left to be inferred: a reader who does not know
        // which mode produced a log cannot tell "the game never logged that"
        // from "detailed mode was off", and those lead to opposite conclusions.
        `Detailed logging: ${verboseLogging ? "ON" : "off"}`,
        "",
        `Entries: ${entries.length} (${formatLogSize(usedChars)} of a ${formatLogSize(MAX_LOG_CHARS)} budget)`,
        droppedEntries
            ? `NOTE: ${droppedEntries} older ${droppedEntries === 1 ? "entry" : "entries"} were dropped to stay inside that budget — this log does not reach back to the start of the session.`
            : "",
        "",
        "-- Log (oldest first) --",
    ].filter((line) => line !== "");

    const body = entries.length
        ? entries.map((entry) => {
            const time = entry.at?.slice(11, 19) || "--:--:--";
            const date = entry.gameDate ? ` {${entry.gameDate}}` : "";
            const detail = entry.detail ? `\n        ${entry.detail}` : "";
            // "×48 over 12s" says storm; the same line with no marker says it
            // happened once. Both matter to a reader deciding whether an error
            // is the bug or the weather.
            const repeat = entry.repeat > 1
                ? ` (×${entry.repeat}, last ${entry.lastAt?.slice(11, 19) || "?"})`
                : "";
            return `[${time}]${date} [${entry.category}] ${entry.message}${repeat}${detail}`;
        })
        : ["(empty — nothing has been logged yet this session)"];

    return [...header, ...body, "", "-- End of log --"].join("\n");
};

// A filename that sorts by time and says which game it came from, because the
// first thing that happens to these is being dragged into a Discord thread with
// three others.
export const debugLogFilename = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `open-historia-log-${stamp}.txt`;
};
