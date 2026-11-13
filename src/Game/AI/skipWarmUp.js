/*! Open Historia — a time skip's opening, read by a local server before the skip is asked for © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/skipWarmUp.test.js
//
// A local server answers one request at a time and keeps what it read of the
// last one: a request that opens with the same tokens reads only the rest. A
// time skip opens with what no turn changes (its functions, the scenario's
// rules, the story so far: promptLayout.js), so the skip after a skip reads
// only its tail. The first skip after the game is opened, or after the server
// was started, reads all of it while the player waits: on a player's 27B model
// (2026-11-13) a month's request was 59,000 tokens, read at 180 to 540 a
// second, which is two to five minutes before the first word is written.
//
// The player spends those minutes writing orders either way. With "Read a
// skip's opening ahead on a local server" on (Settings, AI, Advanced; off by
// default), the opening of the last skip this browser sent to a local server
// is kept, and sent again on its own when the game is opened, and after
// another task has used the server: the same functions and settings, the
// system prompt cut where its unchanging part ends, an answer of one token.
// When the skip is asked for, the server has that part read.
//
// It is the last skip's opening, kept as it was sent, and not one built afresh:
// what a server can reuse is decided token by token, from the first one, and a
// model's template may put the functions before the system prompt (the Qwen
// family's does), so only a request that is the skip's own, cut short, is sure
// to open the same. If the next skip opens otherwise (the story so far was
// rewritten, a setting changed its function), the read was for nothing and the
// skip reads what it would have read without it.
//
// Measured on llama.cpp (the same day, 11,000 tokens): after the opening alone,
// the full request read 4,403 tokens and took 6,930 from the cache (the server
// went back some 500 tokens from where the two part). A server that keeps
// earlier prompts in memory (llama.cpp --cache-ram) had the whole prompt back
// after another task without this; there the first skip of a session is what
// it saves.
//
// Never a hosted provider: there a request is paid for, and its cache is the
// provider's to keep. A warm-up is dropped the moment anything else is asked.
//
// Import-free rules and shapes; main.jsx sends the request.

export const SKIP_OPENING_KEY = "oh_ai_skip_opening";
// An opening shorter than this is read in a moment, and is not worth a request.
export const MIN_OPENING_CHARS = 3000;
// Kept in the browser's storage up to this size; a larger one is kept for the session.
const MAX_STORED_CHARS = 1500000;
// What a request says about its answer rather than its prompt: left out of the kept opening.
const ANSWER_FIELDS = ["messages", "stream", "stream_options", "max_tokens", "max_completion_tokens", "max_new_tokens", "n_predict"];

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const textOf = (value) => (typeof value === "string" ? value : "");

// The opening of a skip's request as it was sent: everything but its messages
// and what it asks of the answer, and the system prompt up to `staticPrefixEnd`.
// null where there is none worth keeping: no system prompt first, no boundary
// inside it, a part too short.
export const openingFromRequest = ({ body, staticPrefixEnd, endpoint = "", campaign = "" } = {}) => {
    if (!isRecord(body) || !Array.isArray(body.messages)) return null;
    const first = body.messages[0];
    const system = first?.role === "system" ? textOf(first.content) : "";
    const end = Math.trunc(Number(staticPrefixEnd));
    if (!system || !Number.isFinite(end) || end < MIN_OPENING_CHARS || end >= system.length) return null;
    const request = Object.fromEntries(Object.entries(body).filter(([key]) => !ANSWER_FIELDS.includes(key)));
    return { endpoint: textOf(endpoint), campaign: textOf(campaign), prefix: system.slice(0, end), request };
};

// The request that has a server read an opening: the skip's own, with the
// system prompt cut short and nothing asked of the answer but its first token.
export const warmUpBody = (opening) => ({
    ...(isRecord(opening?.request) ? opening.request : {}),
    messages: [{ role: "system", content: textOf(opening?.prefix) }, { role: "user", content: "." }],
    max_tokens: 1,
    stream: false,
});

const sameOpening = (one, other) => Boolean(one) && Boolean(other)
    && one.endpoint === other.endpoint && one.campaign === other.campaign && one.prefix === other.prefix
    && JSON.stringify(one.request) === JSON.stringify(other.request);

// The last opening, kept across sessions where the browser's storage takes it.
export const createSkipOpeningMemory = (storage, { maxChars = MAX_STORED_CHARS } = {}) => {
    let held = null;
    let read = false;
    const get = () => {
        if (!read) {
            read = true;
            try {
                const stored = JSON.parse(storage?.getItem(SKIP_OPENING_KEY) ?? "null");
                if (isRecord(stored) && textOf(stored.prefix) && isRecord(stored.request)) held = stored;
            } catch { /* nothing kept, or not ours */ }
        }
        return held;
    };
    // True when the opening is another than the one held.
    const set = (opening) => {
        if (!isRecord(opening) || sameOpening(get(), opening)) return false;
        held = opening;
        read = true;
        try {
            const text = JSON.stringify(opening);
            if (text.length <= maxChars) storage?.setItem(SKIP_OPENING_KEY, text);
            else storage?.removeItem(SKIP_OPENING_KEY);
        } catch { /* storage refused: kept for this session */ }
        return true;
    };
    return { get, set };
};

// What a local server last read, as far as this page knows: "skip" (a skip or
// its opening, so the next skip reads only its tail), "other" (another task),
// or "" (nothing sent to it since the page loaded).
export const createServerReadings = () => {
    const last = new Map();
    return {
        note: (endpoint, kind) => { if (endpoint) last.set(endpoint, kind === "skip" ? "skip" : "other"); },
        last: (endpoint) => last.get(endpoint) ?? "",
    };
};

// Is a warm-up worth sending now? Only with the setting on, an opening kept for
// this campaign, nothing else being asked of any model, and a server that did
// not just read a skip.
export const shouldWarmUp = ({ enabled = false, opening = null, campaign = "", busy = false, lastRead = "" } = {}) => {
    if (!enabled || busy || !isRecord(opening) || !opening.endpoint || !opening.prefix) return false;
    if (campaign && opening.campaign && opening.campaign !== campaign) return false;
    return lastRead !== "skip";
};
