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
// A LOCAL SERVER'S WINDOW IS A SETTING, so nothing learned from one is held
// against it. LM Studio, llama.cpp and the like give a model the context length
// the player loaded it with, and the player changes it by loading it again. A
// player who loaded a model at 40,000 tokens, was refused, and loaded it again
// at 128,000 was told for a month that "the model's window is 40K" and that the
// request "was not sent", with nothing in the game to say otherwise. Asking
// such a server again costs no quota and its refusal comes back at once with
// the window it has now, so the caller passes `trustLearned: false` for an
// entry on the player's own machine or network (localEndpoint.js): its refusal
// is not remembered, and what an earlier build remembered is neither enforced
// nor shown.
//
// THE PLAYER SETS NO WINDOW. Settings → AI had a "Context window (tokens)"
// field and a "Forget this window" button; "remove the context window ai
// setting from the settings" (the owner, 2026-11-02). A window declared there
// by an earlier build is ignored (get), so a figure nobody can see any more
// never keeps a request from being sent: only what a model's own refusal
// taught counts, and that lapses on its own.
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
// A stated limit is trusted for a month, a size merely seen to fail for a week.
export const STATED_LIMIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SEEN_LIMIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const estimateTokens = (chars) => Math.ceil(Math.max(0, Number(chars) || 0) / CHARS_PER_TOKEN);

// ---------------------------------------------------------------------------
// The output limit KoboldCpp is asked for
// ---------------------------------------------------------------------------
//
// A task names no output cap of its own, so its request carries none and the
// model's own maximum applies. A hosted provider's is large, and llama.cpp, LM
// Studio and Ollama read no limit as none at all. KoboldCpp reads it as its
// own default, a few hundred tokens to 2,048 depending on the build
// (koboldCpp.js has the figures): in one player's log, of 224 answers from it,
// seventeen stop between 3,900 and 4,400 characters and the only one longer is
// the advisor's 24,069, the one call that does name a cap. The two the log
// keeps in full stop inside a JSON object at the same half-written word: the
// first failed to parse, was asked for again, and was cut at the same place.
//
// So a request to KoboldCpp that would carry no limit carries this one, and a
// request to any other server carries none, as it always did: a limit there
// would cut answers that complete today (a long turn in Russian, a thinking
// model whose reasoning is counted against it). Which server is KoboldCpp is
// koboldCpp.js's to say.
//
// The number is the room the preflight above already keeps for the answer,
// and not more: KoboldCpp takes the limit out of the context window, so a
// large one leaves less room for the prompt. An entry that needs more, or
// less, says so in its custom parameters ({ "max_tokens": … }), which always
// wins.
export const LOCAL_OUTPUT_LIMIT_TOKENS = DEFAULT_ANSWER_RESERVE_TOKENS;

// The limit one request carries and whose it is: the entry's own (`custom`,
// from its custom parameters, which are merged into the request last), the
// caller's (`task`, the advisor's cap), the one above when the request goes to
// KoboldCpp (`koboldcpp`), or none (`tokens` 0: the provider's maximum).
export const outputLimitFor = ({ maxTokens, customParams, koboldCpp = false } = {}) => {
    const custom = Number(customParams?.max_tokens ?? customParams?.max_completion_tokens);
    if (custom > 0) return { tokens: custom, source: "custom" };
    const asked = Number(maxTokens);
    if (asked > 0) return { tokens: asked, source: "task" };
    if (koboldCpp) return { tokens: LOCAL_OUTPUT_LIMIT_TOKENS, source: "koboldcpp" };
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
    // A window an earlier build let the player declare is not read (see the
    // top of this file): the player cannot see or change it any more.
    const get = (key) => {
        const entry = readJson(storage, CONTEXT_WINDOW_KEY)[key];
        return entry && typeof entry === "object" && entry.source !== "declared" ? entry : null;
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

    // Why a request must not be sent to this entry — or "" when it may be.
    // `trustLearned: false` is for a server whose window is a setting (see the
    // top of this file): nothing learned counts there.
    const refusal = (key, requestTokens, { reserveTokens = DEFAULT_ANSWER_RESERVE_TOKENS, trustLearned = true } = {}) => {
        const known = get(key);
        if (!known) return "";
        if (!trustLearned) return "";
        const age = now() - (Number(known.learnedAt) || 0);
        if (age > (known.source === "stated" ? STATED_LIMIT_TTL_MS : SEEN_LIMIT_TTL_MS)) return "";
        const tokens = Math.max(0, Number(requestTokens) || 0);
        const reserve = Math.max(0, Number(reserveTokens) || 0);
        if (Number.isFinite(known.limitTokens) && known.limitTokens > 0) {
            const room = known.limitTokens * CONTEXT_WINDOW_MARGIN - reserve;
            if (tokens > room) {
                return `this request is about ${formatTokens(tokens)} tokens and the model's window is ${formatTokens(known.limitTokens)}`;
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

    return { get, learn, refusal, forget };
};

// What the player is told when no entry can take the request, before anything
// was sent. `entries` are the ones refused, with why.
export const nothingFitsMessage = (refused, requestTokens) => {
    const list = (Array.isArray(refused) ? refused : [])
        .map(({ label, reason }) => `${label}: ${reason}`)
        .join("; ");
    return `This request (about ${formatTokens(requestTokens)} tokens) does not fit any model in your Fallback list, so it was not sent. ${list}. `
        + "A turn needs a model with a large context window (128K tokens or more is comfortable): pick one in Settings → AI, or shorten what the prompt carries. "
        + "If a model can now take more than it could, the game tries it again by itself once what it learned lapses: a week after a refusal, or a month after the model stated its window.";
};

// ---------------------------------------------------------------------------
// A local server's window, asked for, and the lookup rounds that fit it
// ---------------------------------------------------------------------------
//
// Nothing learned from a local server is held against it (the top of this
// file), and a first request too big for it is refused at once and for free.
// A lookup conversation is another matter: every round sends the whole prompt
// again with the answers so far, so a skip that fitted when it started grows
// with each round. A player's month on a llama.cpp server with a 98,304-token
// window (2026-11-13): 59,000 tokens at the first request, 87,000 by the round
// that wrote the answer, six rounds and four minutes of reading in; one more
// round would have been refused, and the rounds before it wasted.
//
// With "Stop lookups before a local window is full" on (Settings, AI,
// Advanced; off by default), such a server is asked for the window it loaded
// the model with (llama.cpp answers GET /props), and a round that would no
// longer fit it is not offered the lookups: the model writes its answer with
// what it has, as it does when its rounds run out.
//
// The size of the next round is not guessed at four characters a token where
// the server has said better: its count of the round before, over that round's
// characters, is this conversation's own rate (Cyrillic runs near three).

// The origin's /props, or "" for an endpoint that is no address.
export const serverPropsUrl = (endpoint) => {
    const value = textOf(endpoint).trim();
    if (!value) return "";
    try {
        return `${new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`).origin}/props`;
    } catch {
        return "";
    }
};

// The window a llama.cpp server states, or null (another server, an old build).
export const readServerWindow = (props) => {
    const stated = Number(props?.default_generation_settings?.n_ctx ?? props?.n_ctx);
    return Number.isFinite(stated) && stated >= 1000 ? Math.round(stated) : null;
};

// How many tokens a request of `chars` is: at the rate the server counted the
// last one (`lastPromptTokens` for `lastChars`), else at the estimate's.
export const nextRoundTokens = ({ chars = 0, lastChars = 0, lastPromptTokens = 0 } = {}) => {
    const size = Math.max(0, Number(chars) || 0);
    const counted = Number(lastPromptTokens);
    const sent = Number(lastChars);
    if (counted > 0 && sent > 0) return Math.ceil(size * (counted / sent));
    return estimateTokens(size);
};

// Does a request of `requestTokens` leave room for the answer in a window of
// `windowTokens`? An unknown window fits everything: the server settles it.
export const fitsWindow = ({ windowTokens = 0, requestTokens = 0, reserveTokens = DEFAULT_ANSWER_RESERVE_TOKENS } = {}) => {
    const window = Number(windowTokens);
    if (!(window > 0)) return true;
    return Math.max(0, Number(requestTokens) || 0) + Math.max(0, Number(reserveTokens) || 0) <= window * CONTEXT_WINDOW_MARGIN;
};
