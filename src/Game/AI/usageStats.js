/*! Open Historia — provider token accounting © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Reading how many tokens a call actually cost, out of whichever shape the
// provider reports it in.
//
// Why this exists: nothing in the game read `usage` off any provider response,
// which meant the two questions that matter most when tuning prompts — "did that
// change make the call cheaper?" and "how much of the prompt is the schema?" —
// could only be answered by counting characters and guessing at a ratio. A
// jump's system prompt is ~190 KB of mixed prose, JSON schema and campaign
// state, and those three tokenize at visibly different rates, so the guess was
// never good enough to tell a real 30% saving from noise.
//
// Character counts stay useful and stay logged; this adds the real number when
// the provider volunteers it.
//
// DELIBERATELY IMPORT-FREE, like jsonSalvage.js / providerErrors.js /
// idleDeadline.js: picking three field-naming conventions apart is exactly the
// kind of thing that wants direct tests, and nothing in main.jsx can be
// unit-tested (it reaches settings, fetch and the DOM).

const asCount = (value) => {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.round(count) : null;
};

// Prefer a real figure over a zero: Anthropic omits a field it has nothing to
// say about, and some gateways send 0 rather than omitting.
const firstCount = (...values) => {
    for (const value of values) {
        const count = asCount(value);
        if (count !== null) return count;
    }
    return null;
};

/**
 * Normalize a provider response's usage block into one shape.
 *
 * Accepts the whole response envelope (streamed or buffered — the stream
 * assemblers re-emit `usage`/`usageMetadata` verbatim, so both look the same
 * here) and returns `null` when the provider said nothing, so a caller can omit
 * the fields entirely rather than logging a row of zeroes that reads like a
 * measurement.
 *
 * `cachedTokens` is the part of the prompt the provider served from its own
 * prefix cache. It is the number that proves Phase 5's stable-prefix work is
 * doing anything on a hosted provider, the way TTFB proves it on a local one.
 */
export const normalizeUsage = (data) => {
    if (!data || typeof data !== "object") return null;

    // Gemini: usageMetadata { promptTokenCount, candidatesTokenCount,
    // thoughtsTokenCount, cachedContentTokenCount, totalTokenCount }
    const gemini = data.usageMetadata;
    if (gemini && typeof gemini === "object") {
        const promptTokens = firstCount(gemini.promptTokenCount);
        // Thinking tokens are billed as output but reported separately, and a
        // reasoning model spends most of its output there — leaving them out
        // would make a thinking call look cheaper than a non-thinking one.
        const answer = asCount(gemini.candidatesTokenCount) ?? 0;
        const thoughts = asCount(gemini.thoughtsTokenCount) ?? 0;
        const outputTokens = answer + thoughts > 0 ? answer + thoughts : firstCount(gemini.candidatesTokenCount);
        return compact({
            promptTokens,
            outputTokens,
            totalTokens: firstCount(gemini.totalTokenCount),
            cachedTokens: firstCount(gemini.cachedContentTokenCount),
            ...(thoughts > 0 ? { thinkingTokens: thoughts } : {}),
        });
    }

    const usage = data.usage;
    if (!usage || typeof usage !== "object") return null;

    // Anthropic: { input_tokens, output_tokens, cache_read_input_tokens,
    // cache_creation_input_tokens }. Cache reads and writes are NOT included in
    // input_tokens, so the honest "what did this prompt cost" figure is the sum.
    if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
        const input = asCount(usage.input_tokens) ?? 0;
        const cacheRead = asCount(usage.cache_read_input_tokens) ?? 0;
        const cacheWrite = asCount(usage.cache_creation_input_tokens) ?? 0;
        const promptTokens = input + cacheRead + cacheWrite;
        const outputTokens = firstCount(usage.output_tokens);
        return compact({
            promptTokens: promptTokens > 0 ? promptTokens : null,
            outputTokens,
            totalTokens: promptTokens + (outputTokens ?? 0) > 0 ? promptTokens + (outputTokens ?? 0) : null,
            cachedTokens: cacheRead > 0 ? cacheRead : null,
        });
    }

    // OpenAI-shaped: { prompt_tokens, completion_tokens, total_tokens,
    // prompt_tokens_details: { cached_tokens } }. Most compatible gateways copy
    // this, including llama.cpp and Ollama.
    const promptTokens = firstCount(usage.prompt_tokens);
    const outputTokens = firstCount(usage.completion_tokens);
    return compact({
        promptTokens,
        outputTokens,
        totalTokens: firstCount(usage.total_tokens)
            ?? (promptTokens !== null && outputTokens !== null ? promptTokens + outputTokens : null),
        cachedTokens: firstCount(usage.prompt_tokens_details?.cached_tokens),
    });
};

// Drop the nulls so a log line shows only what the provider actually reported.
// Returning null for an all-null block is what lets a caller omit the fields
// entirely rather than logging zeroes that read like a measurement.
const compact = (usage) => {
    const out = {};
    for (const [key, value] of Object.entries(usage)) {
        if (typeof value === "number") out[key] = value;
    }
    return Object.keys(out).length ? out : null;
};

/**
 * A first-byte stopwatch that piggybacks on the activity signal the streaming
 * readers already emit.
 *
 * `readSSE` calls `onActivity()` once per network chunk (idleDeadline.js counts
 * those to decide whether a request has gone silent). The FIRST of those calls
 * is time-to-first-byte, which is the single most useful latency number the game
 * does not currently record: it separates prompt evaluation — the part a stable
 * prompt prefix makes nearly free — from generation, which no amount of prompt
 * work speeds up.
 *
 * Wrap an existing `onActivity` and the wrapped one still does its old job.
 */
export const createFirstByteTimer = (onActivity) => {
    const startedAt = Date.now();
    let firstByteAt = null;
    return {
        note() {
            if (firstByteAt === null) firstByteAt = Date.now();
            if (onActivity) onActivity();
        },
        // null until something arrives, so a call that never answered is not
        // logged as having answered instantly.
        get firstByteMs() {
            return firstByteAt === null ? null : firstByteAt - startedAt;
        },
    };
};
