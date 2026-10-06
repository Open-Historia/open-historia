/*! Open Historia — the context preflight: not sending what cannot fit © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip is a big request — on the built-in scenario about 47,000 tokens,
// more with a long history — and a model with a 32K window refuses it. Until
// now that refusal cost a request and then the turn: the provider's error was
// "other" to the Fallback list, so the call failed there rather than moving to
// an entry with a bigger window, and the next skip made the same request again.
//
// Two things fix that, and both are plain rules on plain data:
//
//   1. REMEMBER what a model said about its window. Most refusals state the
//      numbers ("maximum context length is 32768 tokens", "your messages
//      resulted in 46901 tokens"); parseContextWindowError reads them. When a
//      refusal states nothing, what is remembered is that THIS size did not fit.
//   2. ASK BEFORE SENDING. With a limit known for an entry, a request that
//      cannot fit is not sent to it; the Fallback list moves on to an entry that
//      can, and only when none can does the call fail — before spending anything,
//      with the message that says which model to pick.
//
// Sizes are estimated at four characters a token, the same rate the diagnostics
// use. It is rough, so the preflight keeps a margin (CONTEXT_WINDOW_MARGIN) and
// only ever refuses what is clearly too big: a request near the line is sent,
// and the provider's own answer settles it.
//
// DELIBERATELY IMPORT-FREE, like requestBudget.js: the caller hands in where
// the memory is kept.

export const CONTEXT_WINDOW_KEY = "ai_context_windows";
export const CHARS_PER_TOKEN = 4;
// A known limit is trusted only this far: the estimate is rough, and a model
// that fits 90% of its window is one that fits.
export const CONTEXT_WINDOW_MARGIN = 0.9;
// Room left for the answer when the caller names no cap of its own.
export const DEFAULT_ANSWER_RESERVE_TOKENS = 4096;
// What was learned is forgotten after a while: providers raise limits, and a
// player has no other way to clear a refusal the model itself no longer gives.
// A stated limit is trusted for a month, a size merely seen to fail for a week;
// a limit the player declared is theirs until they change it.
export const STATED_LIMIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SEEN_LIMIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const estimateTokens = (chars) => Math.ceil(Math.max(0, Number(chars) || 0) / CHARS_PER_TOKEN);

// ---------------------------------------------------------------------------
// The output limit a local server is asked for
// ---------------------------------------------------------------------------
//
// A task names no output cap of its own, so its request carried none and the
// model's own maximum applied. A hosted provider's maximum is large. A local
// server's default is whatever its author chose, and koboldcpp's is about a
// thousand tokens: in one player's log, of 224 answers from it, seventeen stop
// between 3,900 and 4,400 characters and the only one longer is the advisor's
// 24,069, the one call that does name a cap. The two the log keeps in full
// stop inside a JSON object at the same half-written word: the first failed to
// parse, was asked for again, and was cut at the same place.
//
// So a request to a local server that would carry no limit carries this one:
// the room the preflight above already keeps for the answer. Not more:
// koboldcpp takes the limit out of the context window, so a large one leaves
// less room for the prompt. An entry that needs more, or less, says so in its
// custom parameters ({ "max_tokens": … }), which always wins.
export const LOCAL_OUTPUT_LIMIT_TOKENS = DEFAULT_ANSWER_RESERVE_TOKENS;

// The limit one request carries and whose it is: the entry's own (`custom`,
// from its custom parameters, which are merged into the request last), the
// caller's (`task`, the advisor's cap), the one above for a local server
// (`local`), or none (`tokens` 0: the provider's maximum).
export const outputLimitFor = ({ maxTokens, customParams, localEndpoint = false } = {}) => {
    const custom = Number(customParams?.max_tokens ?? customParams?.max_completion_tokens);
    if (custom > 0) return { tokens: custom, source: "custom" };
    const asked = Number(maxTokens);
    if (asked > 0) return { tokens: asked, source: "task" };
    if (localEndpoint) return { tokens: LOCAL_OUTPUT_LIMIT_TOKENS, source: "local" };
    return { tokens: 0, source: "" };
};

const textOf = (value) => (typeof value === "string" ? value : value == null ? "" : String(value));

// How many characters one request carries: the system prompt, every turn of
// the history (Gemini parts or plain content), and the tool declarations.
export const requestChars = ({ systemPrompt = "", history = [], tools = [] } = {}) => {
    let chars = textOf(systemPrompt).length;
    for (const message of Array.isArray(history) ? history : []) {
        const parts = Array.isArray(message?.parts) ? message.parts : null;
        if (parts) {
            for (const part of parts) {
                if (typeof part?.text === "string") chars += part.text.length;
                else if (part && typeof part === "object") chars += JSON.stringify(part).length;
            }
        } else if (typeof message?.content === "string") {
            chars += message.content.length;
        } else if (message && typeof message === "object") {
            chars += JSON.stringify(message).length;
        }
    }
    for (const tool of Array.isArray(tools) ? tools : []) {
        if (tool) chars += JSON.stringify(tool).length;
    }
    return chars;
};

// One key per model on one connection. The Fallback entry's id would change
// when the list is edited; the model's window does not.
export const contextWindowKey = (entry) => [entry?.provider, entry?.endpoint, entry?.model].map((value) => textOf(value).trim().toLowerCase()).join("|");

// ---------------------------------------------------------------------------
// Reading a refusal
// ---------------------------------------------------------------------------
//
// The wordings seen in the wild, each stating one or two numbers:
//   "This model's maximum context length is 128000 tokens. However, your
//    messages resulted in 150000 tokens" (OpenAI and most gateways)
//   "maximum context length is 32768 tokens, however you requested 45000 tokens"
//   "prompt is too long: 250123 tokens > 200000 maximum" (Anthropic)
//   "The input token count (1200000) exceeds the maximum number of input tokens
//    allowed (1048576)" (Gemini)
//   "Please reduce the length of the messages" (nothing stated)
// A number is the REQUEST when the few words before it say requested, resulted,
// your messages, token count; else the LIMIT when the words beside it say
// maximum, limit, allowed or context length ("> 200000 maximum" says it after,
// "maximum context length is 32768" before). The first of each wins. Failing
// both, of two large numbers the smaller is the limit; one alone is the limit.
// A number smaller than a thousand is never a window.
const NUMBER_PATTERN = /(\d{1,3}(?:[,.\s]\d{3})+|\d{4,})/g;
const LIMIT_WORDS = /maximum|max\b|limit|allowed|context (?:length|window|size)|supports?|capacity/i;
const REQUEST_WORDS = /requested|resulted|your (?:messages|prompt|input|request)|token count|you (?:sent|asked)|prompt is|contains|has\b/i;

const readNumber = (text) => Number(String(text).replace(/[,.\s]/g, ""));

export const parseContextWindowError = (text) => {
    const source = textOf(text);
    const found = [];
    let match;
    NUMBER_PATTERN.lastIndex = 0;
    while ((match = NUMBER_PATTERN.exec(source))) {
        const value = readNumber(match[1]);
        if (!Number.isFinite(value) || value < 1000) continue;
        const before = source.slice(Math.max(0, match.index - 24), match.index);
        const after = source.slice(match.index + match[1].length, match.index + match[1].length + 24);
        found.push({ value, before, after });
    }
    if (!found.length) return { limitTokens: null, requestedTokens: null };
    let limitTokens = null;
    let requestedTokens = null;
    for (const entry of found) {
        if (REQUEST_WORDS.test(entry.before)) {
            if (requestedTokens === null) requestedTokens = entry.value;
        } else if (LIMIT_WORDS.test(entry.before) || LIMIT_WORDS.test(entry.after)) {
            if (limitTokens === null) limitTokens = entry.value;
        }
    }
    if (limitTokens === null && requestedTokens === null) {
        const values = found.map((entry) => entry.value).sort((a, b) => a - b);
        limitTokens = values[0];
        if (values.length >= 2) requestedTokens = values[values.length - 1];
    }
    if (limitTokens !== null && requestedTokens !== null && requestedTokens < limitTokens) {
        [limitTokens, requestedTokens] = [requestedTokens, limitTokens];
    }
    return { limitTokens, requestedTokens };
};

// ---------------------------------------------------------------------------
// The memory
// ---------------------------------------------------------------------------

const readJson = (storage, key) => {
    try {
        const raw = storage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};
const writeJson = (storage, key, value) => {
    try { storage.setItem(key, JSON.stringify(value)); } catch { /* storage refused: the memory is for this session */ }
};

const formatTokens = (tokens) => (tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens));

export const createContextWindowMemory = (storage, { now = Date.now } = {}) => {
    const get = (key) => {
        const entry = readJson(storage, CONTEXT_WINDOW_KEY)[key];
        return entry && typeof entry === "object" ? entry : null;
    };
    const set = (key, entry) => {
        const all = readJson(storage, CONTEXT_WINDOW_KEY);
        all[key] = entry;
        writeJson(storage, CONTEXT_WINDOW_KEY, all);
    };

    // What a refusal taught: the stated limit when there was one, else that a
    // request of `requestTokens` did not fit. A stated limit replaces a guess;
    // a guess never replaces a stated limit, and only shrinks.
    const learn = (key, { limitTokens = null, requestTokens = null } = {}) => {
        if (!key) return null;
        const before = get(key) ?? {};
        const next = { ...before, learnedAt: now() };
        if (Number.isFinite(limitTokens) && limitTokens > 0) {
            next.limitTokens = Math.round(limitTokens);
            next.source = "stated";
        } else if (Number.isFinite(requestTokens) && requestTokens > 0) {
            const tooBig = Math.round(requestTokens);
            if (!Number.isFinite(before.tooBigTokens) || tooBig < before.tooBigTokens) next.tooBigTokens = tooBig;
            if (!next.source) next.source = "seen";
        } else {
            return before.limitTokens || before.tooBigTokens ? before : null;
        }
        set(key, next);
        return next;
    };

    // The player's own word beats anything learned.
    const declare = (key, limitTokens) => {
        if (!key) return null;
        if (!(Number.isFinite(limitTokens) && limitTokens > 0)) {
            const all = readJson(storage, CONTEXT_WINDOW_KEY);
            delete all[key];
            writeJson(storage, CONTEXT_WINDOW_KEY, all);
            return null;
        }
        const next = { limitTokens: Math.round(limitTokens), source: "declared", learnedAt: now() };
        set(key, next);
        return next;
    };

    // Why a request must not be sent to this entry — or "" when it may be.
    const refusal = (key, requestTokens, { reserveTokens = DEFAULT_ANSWER_RESERVE_TOKENS } = {}) => {
        const known = get(key);
        if (!known) return "";
        const age = now() - (Number(known.learnedAt) || 0);
        if (known.source !== "declared" && age > (known.source === "stated" ? STATED_LIMIT_TTL_MS : SEEN_LIMIT_TTL_MS)) return "";
        const tokens = Math.max(0, Number(requestTokens) || 0);
        const reserve = Math.max(0, Number(reserveTokens) || 0);
        if (Number.isFinite(known.limitTokens) && known.limitTokens > 0) {
            const room = known.limitTokens * CONTEXT_WINDOW_MARGIN - reserve;
            if (tokens > room) {
                return known.source === "declared"
                    ? `this request is about ${formatTokens(tokens)} tokens and the window you set for this model is ${formatTokens(known.limitTokens)}`
                    : `this request is about ${formatTokens(tokens)} tokens and the model's window is ${formatTokens(known.limitTokens)}`;
            }
            return "";
        }
        if (Number.isFinite(known.tooBigTokens) && tokens >= known.tooBigTokens * CONTEXT_WINDOW_MARGIN) {
            return `this request is about ${formatTokens(tokens)} tokens and the model refused one of ${formatTokens(known.tooBigTokens)} before`;
        }
        return "";
    };

    const forget = (key) => {
        const all = readJson(storage, CONTEXT_WINDOW_KEY);
        delete all[key];
        writeJson(storage, CONTEXT_WINDOW_KEY, all);
    };

    // What is remembered and still in force, for Settings → AI: null when
    // nothing is, or when what was learned has lapsed (refusal ignores it too).
    // `until` is when a learned window lapses; a declared one does not.
    const remembered = (key) => {
        const known = get(key);
        if (!known || !(known.limitTokens > 0 || known.tooBigTokens > 0)) return null;
        if (known.source === "declared") return { ...known, until: null };
        const until = (Number(known.learnedAt) || 0) + (known.source === "stated" ? STATED_LIMIT_TTL_MS : SEEN_LIMIT_TTL_MS);
        return until > now() ? { ...known, until } : null;
    };

    return { get, learn, declare, refusal, forget, remembered };
};

// What Settings → AI says about one model's window (remembered() above).
// `formatDate` shows the day a learned window lapses.
export const describeRememberedWindow = (known, { formatDate = (ms) => new Date(ms).toLocaleDateString() } = {}) => {
    if (!known) return "Leave blank and the game learns this model's window from its own refusal. Set it only if you know it.";
    if (known.source === "declared") return `You set this model's window to ${formatTokens(known.limitTokens)} tokens. A request too big for it is not sent to it.`;
    if (known.limitTokens > 0) return `The model said its window is ${formatTokens(known.limitTokens)} tokens. A request too big for it is not sent to it until ${formatDate(known.until)}.`;
    return `The model refused a request of about ${formatTokens(known.tooBigTokens)} tokens. One that big is not sent to it until ${formatDate(known.until)}.`;
};

// What the player is told when no entry can take the request, before anything
// was sent. `entries` are the ones refused, with why.
export const nothingFitsMessage = (refused, requestTokens) => {
    const list = (Array.isArray(refused) ? refused : [])
        .map(({ label, reason }) => `${label}: ${reason}`)
        .join("; ");
    return `This request (about ${formatTokens(requestTokens)} tokens) does not fit any model in your Fallback list, so it was not sent. ${list}. `
        + "A turn needs a model with a large context window (128K tokens or more is comfortable): pick one in Settings → AI, or shorten what the prompt carries. "
        + "If a model can now take more than it could, open its entry in Settings → AI and forget its window under \"This model only\".";
};
