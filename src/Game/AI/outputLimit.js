/*! Open Historia — the output limit a request to a local model server carries © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/outputLimit.test.js
//
// An OpenAI-style request carries no max_tokens unless the task or the entry
// names one. To a hosted provider that means "the model's own maximum", which
// is why it is left out: a long turn's JSON must not be cut short.
//
// A LOCAL server reads the same silence as "my default", and the default can
// be small. A player's log, on koboldcpp, shows it: no answer to a request
// that named no limit is longer than 4,298 characters, and seventeen of them
// stop between 3,950 and 4,298, whatever the size of the prompt. The Actions
// task was cut mid-word at 4,171 characters and, asked again, at 4,173; five
// skips went to canned events on JSON that stops partway. The one caller that
// does name a limit, the advisor, got 24,069 characters out of the same
// server.
//
// So a local endpoint is always told a number: the task's own budget where it
// has one, the entry's own where its custom parameters set one, and otherwise
// LOCAL_OUTPUT_LIMIT_TOKENS, which is the room the context preflight already
// leaves for an answer (contextWindow.js). Not more than that: koboldcpp takes
// max_tokens out of the context window before it reads the prompt, so a large
// figure squeezes the prompt it was meant to make room for. A player who wants
// more sets max_tokens in the entry's custom parameters, and an answer that
// still runs into the limit says so (providerErrors.js OUTPUT_LIMIT_MESSAGE).
//
// Hosted endpoints are untouched: no limit named still means none sent.
//
// Imports only contextWindow.js, which imports nothing, so this runs under bare
// node like the rest of the request rules.

import { DEFAULT_ANSWER_RESERVE_TOKENS } from "./contextWindow.js";

export const LOCAL_OUTPUT_LIMIT_TOKENS = DEFAULT_ANSWER_RESERVE_TOKENS;

// The names an entry's custom parameters can set an output limit under:
// OpenAI's two, and the ones local servers take in their own dialects
// (text-generation-webui, koboldcpp, llama.cpp, Ollama).
const OUTPUT_LIMIT_PARAMS = Object.freeze([
    "max_tokens", "max_completion_tokens", "max_new_tokens", "max_output_tokens", "max_length", "n_predict", "num_predict",
]);

const positive = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
};

// The limit an entry's own custom parameters set, or 0 when they set none.
export const entryOutputLimit = (customParams) => {
    if (!customParams || typeof customParams !== "object") return 0;
    for (const key of OUTPUT_LIMIT_PARAMS) {
        const tokens = positive(customParams[key]);
        if (tokens) return tokens;
    }
    return 0;
};

// What the game itself adds to a request that would otherwise name no limit:
// LOCAL_OUTPUT_LIMIT_TOKENS for a local endpoint, 0 (add nothing) for anything
// else, and 0 whenever the task or the entry has already named one.
export const localOutputLimit = ({ localEndpoint = false, taskTokens = 0, customParams = null } = {}) =>
    (localEndpoint && !positive(taskTokens) && !entryOutputLimit(customParams) ? LOCAL_OUTPUT_LIMIT_TOKENS : 0);

// The same decision as the request's log line states it, so a report shows
// what limit the model was actually working under and who set it. The entry's
// own parameter is spread into the request last and so wins over the task's.
export const describeOutputLimit = ({ localEndpoint = false, taskTokens = 0, customParams = null } = {}) => {
    const fromEntry = entryOutputLimit(customParams);
    if (fromEntry) return `${fromEntry} (set on the entry)`;
    if (positive(taskTokens)) return positive(taskTokens);
    if (localEndpoint) return `${LOCAL_OUTPUT_LIMIT_TOKENS} (local server: none was set, so the game sets one)`;
    return "(provider maximum)";
};
