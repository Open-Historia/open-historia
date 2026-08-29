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

const MAX_ENTRIES = 400;
const MAX_DETAIL_CHARS = 600;
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
// localStorage is a ~5 MB budget shared with the translator cache, the flag
// library and every setting. The log is the least important thing in it, so it
// is capped well under that and drops its oldest entries to stay there.
const MAX_STORED_CHARS = 192 * 1024;
const PERSIST_DEBOUNCE_MS = 800;

let entries = [];
let sequence = 0;
let context = {};
let persistTimer = null;
let captureInstalled = false;
const listeners = new Set();

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
        // The first stack frame is where it actually threw; the rest is React
        // internals nine times out of ten and swamps the entry.
        const frame = String(detail.stack || "").split("\n")[1]?.trim();
        return `${detail.name}: ${detail.message}${frame ? ` (${frame})` : ""}`;
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

const truncate = (text, limit = MAX_DETAIL_CHARS) =>
    text.length > limit ? `${text.slice(0, limit)}… (+${text.length - limit} chars)` : text;

// The one way anything gets into the log.
//
// `category` is a short tag the reader scans down the left margin ("game",
// "turn", "ai", "action", "error"). `message` is what happened, in the past
// tense. `detail` is optional and gets flattened and truncated.
export const logDebugEvent = (category, message, detail) => {
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
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
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

// `silent` exists for the tests, which need a genuinely empty buffer to count
// entries in. The player-facing path always leaves the note: a log that jumps
// from boot to mid-campaign with no explanation reads like lost entries, and a
// reader chasing a phantom gap is worse off than one told there is none.
export const clearDebugLog = ({ silent = false } = {}) => {
    entries = [];
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
    try {
        let payload = JSON.stringify({ version: 1, context, entries });
        // Drop the oldest half and retry rather than giving up: a log that keeps
        // the last hundred entries beats no log at all.
        while (payload.length > MAX_STORED_CHARS && entries.length > 1) {
            entries = entries.slice(Math.ceil(entries.length / 2));
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
        entries = parsed.entries.slice(-MAX_ENTRIES);
        sequence = entries.length ? Number(entries[entries.length - 1]?.seq) || entries.length : 0;
        if (parsed.context && typeof parsed.context === "object") context = { ...parsed.context };
    } catch {
        // Truncated or written by an older build — start clean rather than
        // showing half an entry.
        entries = [];
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

    restorePersisted();
    if (entries.length) {
        logDebugEvent("app", "— page reloaded; entries above are from the previous session —");
    }

    if (typeof console !== "undefined") {
        let inside = false;
        for (const [method, category] of [["warn", "warn"], ["error", "error"]]) {
            const original = console[method]?.bind(console);
            if (!original) continue;
            console[method] = (...args) => {
                original(...args);
                if (inside) return;
                inside = true;
                try {
                    const [first, ...rest] = args;
                    logDebugEvent(category, describeDetail(first), rest.length ? rest : undefined);
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
        "",
        `Entries: ${entries.length}${entries.length >= MAX_ENTRIES ? ` (oldest dropped — buffer holds ${MAX_ENTRIES})` : ""}`,
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
