/*! Open Historia — in-game diagnostics log © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The log a player can paste into a bug report.
//
// Before this, the only diagnostics the game could hand out were per-incident:
// the advisor's "Copy for a bug report" and the timeline's "Copy debugging
// message" (time.jsx), both of which described ONE failed AI turn and nothing
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
// Those per-incident buttons are now "Save logging file" buttons
// (runtime/saveDebugLog.js). Pasting only the incident is what players did, and
// it left out everything around it, so the buttons now save THIS log with the
// incident's own details attached at the top — see `incident` on
// buildDebugLogReport.
//
// ONE LOG, ONE FILE. On desktop, the app's Electron process and its local server
// see things the page never can — a launch that failed before the page existed,
// an update that did not take, a server error — and they cannot reach this
// buffer, so they write the Desktop log (server/logStore.js). Every way out of
// here (buildLoggingFile) fetches those entries and merges them in by time, so
// the player sends one Logging file of at most 1 MB. Each entry is stored once,
// by whoever saw it: the page never writes to the Desktop log.
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
// Campaign text in the NORMAL log is kept short on purpose: titles, counts and
// ids, not event prose or chat bodies. A log a player is willing to paste in
// public is worth more than a complete one they are not. Detailed mode is the
// deliberate exception — see below.
//
// TWO SWITCHES, both in Settings → Diagnostics and both persisted in
// localStorage so they survive closing the app and switching campaigns:
//
//   * Logging (default ON). Off means nothing is recorded and the stored log is
//     thrown away — and, on the machine running the server, the Desktop log
//     with it. Checked at the top of logDebugEvent so a disabled log costs the
//     game nothing beyond a boolean test.
//   * Detailed logging (default OFF). Adds the entries marked `{ verbose: true }`
//     at their call sites — every AI task and API call rather than only the
//     failures, a prompt fingerprint per AI attempt, world-state changes turn by
//     turn, panel navigation, console.log chatter — and keeps far more of each
//     one (longer details, deeper stacks). Never a whole prompt: the fingerprint
//     is what lets a prompt rebuilt from the save be checked against it.
//     It is off by default because it is heavier and quotes more of the
//     campaign, and on when a maintainer asks for it.
//
//     It also carries the full text of every conversation with the model: what
//     the player asked the advisor and what it answered, every diplomatic
//     message in both directions, and the notes a turn or the idle drip put in
//     the player's inbox. That is a deliberate choice, because the bugs people
//     actually report about the advisor and diplomacy — "it forgot what I told
//     it", "it replied as the wrong country", "it drafted a letter and sent
//     something else", "the block it sent never reached the board" — are all
//     about the CONTENT of an exchange, and a log recording only that an
//     exchange happened cannot settle any of them. Everything on this path is
//     campaign fiction the player wrote or the model wrote back; none of it is a
//     credential (redactSecrets still runs over it), but it is much more of
//     their campaign than the normal log quotes, and the Diagnostics panel says
//     so beside the switch.
//
// The buffer is bounded by SIZE, not only by entry count, and drops its oldest
// entries to stay there — see trimToBudget.

import { escapeForRegExp, redactLogText } from "../../server/logRedaction.js";

// Two ceilings, and the size one is the one that really governs. Both modes
// share them: they differ in WHAT they record, not in how much of it they keep.
//
// MAX_ENTRIES stops a quiet session growing without bound; MAX_LOG_CHARS is what
// keeps the log inside the storage it has to live in, and matches the Logging
// file's own 1 MB, so the log never holds more than a report can carry. A normal
// log used to get 192 KB and 400 entries, which on a busy campaign reached back
// barely an hour; a detailed one carries whole conversations, and against that
// budget one long consultation would evict the campaign that led up to it.
const MAX_ENTRIES = 5000;
// localStorage is a ~5 MB budget shared with the translator cache and every
// setting. Characters, not bytes — Chromium stores them as UTF-16, so 1 MB here
// is ~2 MB of the quota, still well inside it. The cost that grows with it is
// the background save, which rewrites the whole buffer: measured in Chromium at
// ~5 ms for a full 1 MB log (6 ms at worst), inside one 60 fps frame. If that
// ever stops being true, the normal log is the one to shrink back.
const MAX_LOG_CHARS = 1024 * 1024;
const MAX_DETAIL_CHARS = 600;
// Detailed mode keeps far more of each detail: a truncated stack trace, a
// clipped raw model response or an advisor reply cut off mid-sentence is usually
// worth nothing at all, and the whole point of turning it on is to stop losing
// them. 20k is chosen to clear a long advisor answer (a few thousand characters,
// plus whatever fenced blocks it carries) whole.
const MAX_DETAIL_CHARS_VERBOSE = 20_000;
// Frames of an Error's stack. One is where it threw, which is all a normal log
// needs; the rest is React internals nine times out of ten. Detailed mode keeps
// enough to actually walk a call path.
const STACK_FRAMES = 1;
const STACK_FRAMES_VERBOSE = 8;
// Repeat collapsing. A failing basemap host or a dead content node produces the
// same fetch error dozens of times a second, and left alone one bad tile URL
// evicts the entire campaign from the buffer — the exact entries the log exists
// for. So an entry identical to a recent one bumps that entry's counter
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
const MAX_STORED_CHARS = 1200 * 1024;
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
        clearDesktopLog();
        emit();
    }
};

// "The log on this device is deleted" covers the Desktop log too, on the machine
// that runs the server: the page asks, and the server refuses any other device
// (server.js), so a phone's switch never reaches into the host's files. The
// refusal, and the web and Android builds' 404, are simply ignored. The desktop
// app and the server go on noting their own errors afterwards — never campaign
// text — and Settings says so.
const clearDesktopLog = () => {
    try {
        globalThis.fetch?.("/api/log", { method: "DELETE" })?.catch?.(() => {});
    } catch { /* no fetch here — nothing to clear */ }
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
    // Both modes share one budget, so switching throws nothing away; what was
    // collected in detailed mode stays until newer entries push it out.
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
//
// Connections keep their keys inside one stored JSON list (`ai_connections`),
// as the profiles before them did (`ai_provider_presets`), so those lists are
// opened and every `apiKey` field in them counted too. Only lists named so:
// this runs for every entry, and the log keeps its own megabyte in storage.
const collectApiKeyFields = (node, into, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 4) return;
    for (const [field, value] of Object.entries(node)) {
        if (field === "apiKey" && typeof value === "string") into.push(value);
        else collectApiKeyFields(value, into, depth + 1);
    }
};

const storedSecretValues = () => {
    if (typeof localStorage === "undefined") return [];
    const found = [];
    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key) continue;
            const value = localStorage.getItem(key);
            if (typeof value !== "string") continue;
            if (/(_api_key|_token|_secret)$/i.test(key)) {
                found.push(value);
            } else if (/(_connections|_presets)$/i.test(key)) {
                try { collectApiKeyFields(JSON.parse(value), found); } catch { /* not JSON after all */ }
            }
        }
    } catch { /* storage disabled — fall through to the patterns below */ }
    // Very short values are not keys and would redact half the log if treated
    // as one (a stray "1" would eat every number in it).
    return found.map((value) => value.trim()).filter((value) => value.length >= 8);
};

// Run over every entry as it is recorded, and over every Desktop log entry as it
// enters the Logging file. The literal pass first, then the shared rules
// (server/logRedaction.js) — the key shapes and the player's home folder — for
// what the literal pass cannot reach: a key the player typed into a chat, one
// in a pasted URL, one this device has not stored (a LAN client reporting on the
// host's behalf), and a server error quoting a path under the player's name.
// Deliberately blunt: over-redacting costs a reader a little context,
// under-redacting publishes a player's key.
export const redactSecrets = (value) => {
    let text = String(value ?? "");
    if (!text) return text;

    for (const secret of storedSecretValues()) {
        text = text.replace(new RegExp(escapeForRegExp(secret), "g"), "[redacted API key]");
    }
    return redactLogText(text);
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
    let dropped = 0;
    while (entries.length > 1 && (entries.length > MAX_ENTRIES || usedChars > MAX_LOG_CHARS)) {
        usedChars -= entryCost(entries[0]);
        entries.shift();
        dropped += 1;
    }
    if (dropped) droppedEntries += dropped;
    return dropped;
}

// The recent entry that `entry` repeats — same category, message and detail,
// within COALESCE_WINDOW entries and COALESCE_MS of its last occurrence — or
// null. One test for both foldings: the page's, as entries are recorded, and the
// Desktop log's, as the Logging file is built.
const findRepeatOf = (list, entry, now) => {
    for (let index = list.length - 1; index >= Math.max(0, list.length - COALESCE_WINDOW); index -= 1) {
        const candidate = list[index];
        if (candidate.category !== entry.category || candidate.message !== entry.message || candidate.detail !== entry.detail) continue;
        return now - Date.parse(candidate.lastAt || candidate.at) <= COALESCE_MS ? candidate : null;
    }
    return null;
};

// The one way anything gets into the log.
//
// `category` is a short tag the reader scans down the left margin ("game",
// "turn", "ai", "action", "error"). `message` is what happened, in the past
// tense. `detail` is optional and gets flattened and truncated. `problem: true`
// marks an entry View log's "problems only" should keep even though its
// category is not an error one — a failed AI task is logged as `ai`.
export const logDebugEvent = (category, message, detail, { verbose = false, problem = false } = {}) => {
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

    const repeated = findRepeatOf(entries, { category: safeCategory, message: safeMessage, detail: safeDetail }, now);
    if (repeated) {
        repeated.repeat = (repeated.repeat || 1) + 1;
        repeated.lastAt = new Date(now).toISOString();
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
        ...(problem ? { problem: true } : {}),
    });
    usedChars += entryCost(entries[entries.length - 1]);
    trimToBudget();
    schedulePersist();
    emit();
};

// ---------------------------------------------------------------------------
// Game settings
// ---------------------------------------------------------------------------
//
// Two halves, because a report needs both. The CHANGES go in the log as they
// happen (logSettingChange), so a reader sees "turned the globe on, then the
// turn broke". The STATE goes in the Logging file as it is saved (the settings
// snapshot), because a switch flipped last month — or never touched, sitting at
// its default — is in no log at all, and "was X on?" is the first question.

// How long a typed setting — a model name, a font, an endpoint — must sit still
// before its change is logged. The fields save on every keystroke, and "Label
// font set to T", "…Ti", "…Tim" is noise that buries the one line that matters.
const SETTING_SETTLE_MS = 1500;
const settlingSettings = new Map();

// A setting's change as a line of its own wording — for the ones that must not
// say their value (an API key is "set" or "cleared", never shown). `key` names
// the setting for settling, so two fields typed at once settle separately.
export const logSettingMessage = (key, message, { settle = false } = {}) => {
    if (!settle) {
        logDebugEvent("setting", message);
        return;
    }
    clearTimeout(settlingSettings.get(key));
    settlingSettings.set(key, setTimeout(() => {
        settlingSettings.delete(key);
        logDebugEvent("setting", message);
    }, SETTING_SETTLE_MS));
};

// One line per change, in words: a switch "turned on/off", anything else "set
// to" its new value. `settle` holds the line until the value stops changing.
export const logSettingChange = (label, value, { settle = false } = {}) =>
    logSettingMessage(label, typeof value === "boolean"
        ? `${label} turned ${value ? "on" : "off"}.`
        : `${label} set to ${value}.`, { settle });

// The snapshot: each part of the game that owns settings registers a reader for
// its section (src/runtime/settingsLog.js registers them all), and the Logging
// file calls every reader as it is built, so the values are the ones in force
// at that moment. A reader returns `[label, value]` pairs, or a promise of them
// (the server's network setting is a request away), or null when the section
// means nothing here. Registration rather than imports because the settings
// modules import this one.
const settingsReaders = new Map();

export const registerSettingsSnapshot = (section, read) => {
    settingsReaders.set(section, read);
    return () => settingsReaders.delete(section);
};

// Never throws, and never waits longer than the Desktop log does. A section that
// fails says so in the file rather than vanishing — "could not be read" and "was
// off" are different answers.
const readSettingsSnapshot = async ({ timeoutMs = DESKTOP_LOG_TIMEOUT_MS } = {}) => {
    const sections = await Promise.all([...settingsReaders].map(async ([section, read]) => {
        let timer = null;
        try {
            const items = await Promise.race([
                Promise.resolve().then(read),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), timeoutMs); }),
            ]);
            return Array.isArray(items) && items.length ? { section, items } : null;
        } catch (error) {
            return { section, items: [[`(could not be read: ${error?.message || error})`]] };
        } finally {
            clearTimeout(timer);
        }
    }));
    return sections.filter(Boolean);
};

const settingsLines = (settings) => {
    if (!Array.isArray(settings) || !settings.length) return [];
    const lines = ["", "-- Settings when this file was saved --"];
    for (const { section, items } of settings) {
        lines.push(`${section}:`);
        for (const [label, value] of items) {
            lines.push(value === undefined ? `  ${label}` : `  ${label}: ${value}`);
        }
    }
    return lines.map(redactSecrets);
};

// The same settings block the Logging file carries, on its own, for the
// settings.txt that rides inside an exported Game. Same readers and the same
// redaction — a key is still only "set"/"not set", an endpoint still only a host
// — so a Game that reaches a maintainer without a log still says what it was
// played with. It is a RECORD, never applied: importing a game changes nobody's
// settings, because these are device-wide and a stranger's are either
// meaningless here or actively wrong (a basemap chosen for that player's GPU,
// say). The settings that should follow a game already do — they
// live in its game.json.
export const buildSettingsReport = async () => {
    const lines = settingsLines(await readSettingsSnapshot());
    if (!lines.length) return "";
    // settingsLines opens with a blank separator line, which is right inside the
    // Logging file and wrong at the top of a file of its own.
    while (lines.length && !lines[0].trim()) lines.shift();
    return `${lines.join("\n")}\n`;
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
                ...(entry.problem === true ? { problem: true } : {}),
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

// Set while a caller writes to the console something it has already logged
// properly, so the capture below does not record it a second time.
let consoleCaptureMuted = false;

export const withConsoleCaptureMuted = (run) => {
    const previous = consoleCaptureMuted;
    consoleCaptureMuted = true;
    try {
        return run();
    } finally {
        consoleCaptureMuted = previous;
    }
};

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
                if (inside || consoleCaptureMuted) return;
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

// `[label, value]` pairs as report lines: arrays one entry per indented line,
// multi-line text (a raw model response) under its label, empty values skipped
// so a field the failure never filled in is not printed as a blank.
export const formatReportFields = (fields = []) => {
    const lines = [];
    for (const [label, value] of fields) {
        if (value === "" || value === null || value === undefined) continue;
        if (Array.isArray(value)) {
            if (value.length === 0) continue;
            lines.push(`${label}:`);
            for (const entry of value) lines.push(`  ${String(entry)}`);
            continue;
        }
        const text = String(value);
        lines.push(text.includes("\n") ? `${label}:\n${text}` : `${label}: ${text}`);
    }
    return lines;
};

// Incident fields the header already states, by label. One whose value matches
// the header is dropped rather than printed twice; one that DIFFERS is kept,
// because then it is news — an advisor error recorded on a model the player has
// since switched away from says which model actually failed.
const HEADER_FIELD_KEYS = {
    "ai provider": "provider",
    provider: "provider",
    "ai model": "model",
    model: "model",
    "player polity": "playerCountry",
    difficulty: "difficulty",
    "player focus": "playerFocus",
    round: "round",
    "game date": "gameDate",
};

const sameAsHeader = (label, value) => {
    const key = HEADER_FIELD_KEYS[String(label).trim().toLowerCase()];
    if (!key || !context[key] || Array.isArray(value)) return false;
    return String(value ?? "").trim().toLowerCase() === String(context[key]).trim().toLowerCase();
};

// Everything the player pastes, as one plain-text block: a header saying what
// build and what campaign this is, then the entries oldest-first.
//
// Plain text, not JSON — it is going into a Discord message or a GitHub issue,
// where a human reads it and a code fence is the only formatting available.
//
// `incident` is what the per-incident "Save logging file" buttons attach: the
// one failure the player was looking at when they pressed it, as
// `{ title, fields: [[label, value], ...] }`. It goes between the header and the
// log, so a reader sees what was reported before the sequence that led up to
// it. It is written here at export time rather than logged as an entry, for
// three reasons: an entry is clipped to a few hundred characters and a raw model
// response is the part a fallback report exists for; an entry can be rolled off
// the front by the size cap; and a player with logging turned off still gets a
// file worth sending. Redacted like everything else.
// ---------------------------------------------------------------------------
// The Desktop log, merged in
// ---------------------------------------------------------------------------
//
// On desktop, the app's Electron process and its local server cannot reach this
// buffer, so they write their own entries to the Desktop log (server/logStore.js).
// The Logging file merges those entries in here, by time, so the player sends one
// file. `desktop` is `{ status, entries }` from fetchDesktopLog below; entries are
// the store's raw `{ at, level, source, event, message, data }`.

// Only the Electron process's and the server's own entries. Older builds also
// copied page entries and whole AI prompts into the Desktop log; the page entries
// are already here, and a prompt alone could fill the file.
const DESKTOP_SOURCE_LABELS = { main: "desktop app", server: "server" };

// When this page started, for a span with no page entries in it (logging off, or
// just cleared).
const PAGE_STARTED_AT = new Date().toISOString();

// Where the Logging file begins: the oldest page entry still held. The buffer
// survives reloads and restarts, so a launch that failed between two good ones —
// written only to the Desktop log, because the page never loaded — falls inside
// it. Passed to the server so it only sends what can be used.
const getLoggingFileSpanStart = () => entries[0]?.at || PAGE_STARTED_AT;

// Held to the same limits as a page entry in the current mode, and redacted with
// the full page redactor — including this device's stored keys, which the server
// and the Electron process cannot see. This is the choke point for everything
// that leaves the machine.
const fromDesktopEntry = (entry) => {
    const message = entry.event ? `${entry.event}: ${entry.message ?? ""}` : String(entry.message ?? "");
    const detail = typeof entry.data === "string" ? entry.data : "";
    return {
        at: String(entry.at || ""),
        gameDate: "",
        category: DESKTOP_SOURCE_LABELS[entry.source],
        message: redactSecrets(truncate(message)),
        detail: detail ? redactSecrets(truncate(detail)) : "",
        problem: entry.level === "error" || entry.level === "warn",
    };
};

// The page folds its repeats as they are recorded (logDebugEvent); the Desktop
// log's arrive as they were written, so the same folding happens here. A dead
// flag host answering 404 forty times must not push the session out of the file.
const foldRepeats = (list) => {
    const folded = [];
    for (const entry of list) {
        const match = findRepeatOf(folded, entry, Date.parse(entry.at));
        if (match) {
            match.repeat = (match.repeat || 1) + 1;
            match.lastAt = entry.at;
        } else {
            folded.push({ ...entry });
        }
    }
    return folded;
};

const desktopEntriesInSpan = (desktop) => {
    const spanStart = Date.parse(getLoggingFileSpanStart());
    return (Array.isArray(desktop?.entries) ? desktop.entries : [])
        .filter((entry) => DESKTOP_SOURCE_LABELS[entry?.source] && Date.parse(entry.at) >= spanStart);
};

// Stated in the header, because a missing desktop error means nothing if the
// Desktop log was never read, and a reader cannot otherwise tell.
const desktopStatusLine = (desktop) => {
    if (!desktop) return "";
    if (desktop.status === "included") {
        const count = desktopEntriesInSpan(desktop).length;
        return `Desktop log: included (${count} ${count === 1 ? "entry" : "entries"} from the desktop app and server)`;
    }
    if (desktop.status === "unavailable") {
        return "Desktop log: unavailable — the local server did not answer, so the desktop app's and server's own entries are missing";
    }
    return "Desktop log: none on this platform";
};

// What View log's "problems only" keeps from the page's own entries.
const PROBLEM_CATEGORIES = new Set(["error", "warn", "crash"]);

// Page entries and Desktop log entries as one list, oldest first. A tie keeps the
// page entry first, since its order within the page is already known.
const mergeWithDesktop = (pageEntries, desktop) => {
    const desktopEntries = foldRepeats(desktopEntriesInSpan(desktop)
        .map(fromDesktopEntry)
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
    const merged = [];
    let next = 0;
    for (const entry of pageEntries) {
        while (next < desktopEntries.length && Date.parse(desktopEntries[next].at) < Date.parse(entry.at)) {
            merged.push(desktopEntries[next]);
            next += 1;
        }
        merged.push({ ...entry, problem: entry.problem === true || PROBLEM_CATEGORIES.has(entry.category) });
    }
    return merged.concat(desktopEntries.slice(next));
};

// One entry as a line of the file.
const renderEntry = (entry) => {
    const time = entry.at?.slice(11, 19) || "--:--:--";
    const date = entry.gameDate ? ` {${entry.gameDate}}` : "";
    const detail = entry.detail ? `\n        ${entry.detail}` : "";
    // "×48 over 12s" says storm; the same line with no marker says it happened
    // once. Both matter to a reader deciding whether an error is the bug or the
    // weather.
    const repeat = entry.repeat > 1
        ? ` (×${entry.repeat}, last ${entry.lastAt?.slice(11, 19) || "?"})`
        : "";
    return `[${time}]${date} [${entry.category}] ${entry.message}${repeat}${detail}`;
};

// How big the Logging file may get. It is read whole by whoever diagnoses the
// report, often a model with a 1M-token window that also has to read the code.
//
// The header and the log itself get 1 MB — about a third of that window,
// leaving the rest for the fix. The reported problem comes on top of that and
// is not cut: it is what the player pressed the button about, and a normal one
// is a few kilobytes. Only if it would take the whole file past 2 MB is it cut,
// in the middle, keeping its start and end. Characters, not bytes; the file is
// almost entirely ASCII.
const LOG_SECTION_MAX_CHARS = 1024 * 1024;
const LOGGING_FILE_MAX_CHARS = 2 * 1024 * 1024;
// Room kept for the notes that say something was left out or cut, which are only
// known once the trimming is done.
const FILE_NOTE_RESERVE_CHARS = 200;

// A reported problem cut down to `allowed` characters: its start and its end,
// which are where a raw model response shows what it was and where it broke.
const cutReportedProblem = (text, allowed) => {
    const marker = (cut) => `\n[… ${cut} characters of the reported problem cut here to keep this file within 2 MB …]\n`;
    const room = Math.max(0, allowed - marker(text.length).length);
    const head = Math.ceil(room * 0.6);
    const tail = room - head;
    return `${text.slice(0, head)}${marker(text.length - room)}${text.slice(text.length - tail)}`;
};

// The Logging file in parts: header lines, the reported problem, and the entries
// it has room for, oldest first. One composition behind both the file and View
// log, so what a player looks at is what they send.
const composeLoggingFile = ({ incident, desktop, settings } = {}) => {
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
        contextLine("Player focus", context.playerFocus),
        "",
        // Provider and model NAMES only. Which model a player is on is the
        // single most useful line in an AI bug report, and it is not a secret;
        // the key that reaches it is, and never appears here.
        contextLine("AI provider", context.provider),
        contextLine("AI model", context.model),
        // Stated rather than left to be inferred: a reader who does not know
        // which mode produced a log cannot tell "the game never logged that"
        // from "detailed mode was off", and those lead to opposite conclusions.
        `Detailed logging: ${verboseLogging ? "ON" : "off"}`,
        "",
        `Entries: ${entries.length} (${formatLogSize(usedChars)} of a ${formatLogSize(MAX_LOG_CHARS)} budget)`,
        droppedEntries
            ? `NOTE: ${droppedEntries} older ${droppedEntries === 1 ? "entry" : "entries"} were dropped to stay inside that budget — this log does not reach back to the start of the session.`
            : "",
        desktopStatusLine(desktop),
    ].filter((line) => line !== "");

    const incidentLines = incident
        ? formatReportFields((incident.fields ?? []).filter(([label, value]) => !sameAsHeader(label, value)))
        : [];
    const incidentBlock = incident
        ? ["", redactSecrets(`-- Reported problem: ${incident.title || "unspecified"} --`), ...incidentLines.map(redactSecrets), ""]
        : [];

    const logEntries = mergeWithDesktop(entries, desktop);
    const logLines = logEntries.map(renderEntry);

    // The log's own ceiling in the file, over and above the buffer's: header
    // and every entry, not counting the reported problem. The oldest entries go
    // first, for the same reason as in trimToBudget.
    const settingsBlock = settingsLines(settings);
    let logTotal = [...header, ...settingsBlock, "-- Log (oldest first) --", ...FILE_FOOTER].join("\n").length
        + FILE_NOTE_RESERVE_CHARS
        + logLines.reduce((sum, line) => sum + line.length + 1, 0);
    let leftOut = 0;
    while (leftOut < logLines.length && logTotal > LOG_SECTION_MAX_CHARS) {
        logTotal -= logLines[leftOut].length + 1;
        leftOut += 1;
    }
    if (leftOut) {
        header.push(`NOTE: ${leftOut} older ${leftOut === 1 ? "entry was" : "entries were"} left out to keep this log within 1 MB.`);
    }

    // Then the reported problem on top, cut only past the whole file's ceiling.
    const incidentText = incidentBlock.join("\n");
    const incidentRoom = LOGGING_FILE_MAX_CHARS - logTotal - FILE_NOTE_RESERVE_CHARS;
    const reportedProblem = incidentText.length > incidentRoom
        ? [cutReportedProblem(incidentText, incidentRoom)]
        : incidentBlock;

    return {
        header: [...header, ...settingsBlock],
        incidentBlock: reportedProblem,
        entries: logEntries.slice(leftOut),
        lines: logLines.slice(leftOut),
    };
};

const FILE_FOOTER = ["", "-- End of log --"];

export const buildDebugLogReport = ({ incident, desktop, settings } = {}) => {
    const { header, incidentBlock, lines } = composeLoggingFile({ incident, desktop, settings });
    const body = lines.length
        ? lines
        // Said outright when logging is off: the Save buttons beside a fallback
        // or an advisor error work either way, and a reader handed an empty log
        // with no reason given goes looking for a recording bug.
        : [loggingEnabled
            ? "(empty — nothing has been logged yet this session)"
            : "(logging is turned off in Settings → Diagnostics, so nothing was recorded)"];

    return [...header, ...incidentBlock, "-- Log (oldest first) --", ...body, ...FILE_FOOTER].join("\n");
};

// What Settings → Diagnostics → View log lists: the Logging file's entries,
// newest first — the thing that just went wrong is what the player is looking
// for. Each carries `problem` for the "problems only" filter.
export const getLoggingFileEntries = ({ desktop } = {}) =>
    composeLoggingFile({ desktop }).entries.slice().reverse();

// How long the Logging file waits for the Desktop log. Short on purpose: a dead
// server must not hold the save, and a save or copy that waits too long stops
// counting as the player's click, which the clipboard needs.
const DESKTOP_LOG_TIMEOUT_MS = 2000;

// The Desktop log's entries for the Logging file's span, from the server this
// page was served by — the host's, for a phone or LAN browser playing on
// someone's desktop. Never throws. A 404 is the web and Android builds, whose
// in-browser API answers every unknown route that way: there is no Desktop log
// there, rather than one that failed.
export const fetchDesktopLog = async ({ fetchImpl = globalThis.fetch, timeoutMs = DESKTOP_LOG_TIMEOUT_MS } = {}) => {
    if (typeof fetchImpl !== "function") return { status: "none", entries: [] };
    const url = `/api/log?since=${encodeURIComponent(getLoggingFileSpanStart())}`;
    let timer = null;
    try {
        const response = await Promise.race([
            fetchImpl(url, { cache: "no-store" }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), timeoutMs); }),
        ]);
        if (response.status === 404) return { status: "none", entries: [] };
        if (!response.ok) return { status: "unavailable", entries: [] };
        const body = await response.json();
        return { status: "included", entries: Array.isArray(body?.entries) ? body.entries : [] };
    } catch {
        return { status: "unavailable", entries: [] };
    } finally {
        clearTimeout(timer);
    }
};

// The Logging file, Desktop log included. Every way out goes through here —
// Settings' Copy and Save and every failure button — so they all hand over the
// same thing.
export const buildLoggingFile = async ({ incident, fetchImpl, timeoutMs } = {}) => {
    const [desktop, settings] = await Promise.all([
        fetchDesktopLog({ fetchImpl, timeoutMs }),
        readSettingsSnapshot({ timeoutMs }),
    ]);
    return buildDebugLogReport({ incident, desktop, settings });
};

// The incident on its own, for when there is no log to attach it to.
//
// With logging turned off the failure buttons go back to copying a report of
// the one failure (runtime/saveDebugLog.js) — a log file would be an empty
// header around it. So this carries the context lines the log's header would
// have, and repeats every field, since there is no header to deduplicate
// against.
export const buildIncidentReport = (incident) => {
    if (!incident) return "";
    const lines = [
        `OPEN HISTORIA — ${String(incident.title || "debug report").toUpperCase()}`,
        `Generated: ${new Date().toISOString()}`,
        contextLine("Build", context.build),
        contextLine("Player polity", context.playerCountry),
        contextLine("Game date", context.gameDate),
        contextLine("Difficulty", context.difficulty),
        contextLine("AI provider", context.provider),
        contextLine("AI model", context.model),
    ].filter((line) => line !== "");
    return redactSecrets([...lines, "", ...formatReportFields(incident.fields)].join("\n"));
};

// A filename that sorts by time and says what it was saved for, because the
// first thing that happens to these is being dragged into a Discord thread with
// three others. `tag` is the incident's kind ("turn-fallback", "advisor-error");
// the Settings button passes none.
export const debugLogFilename = (tag = "") => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const suffix = String(tag ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `open-historia-log-${stamp}${suffix ? `-${suffix}` : ""}.txt`;
};
