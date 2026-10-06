/*! Open Historia — which model server is told an output limit: KoboldCpp, known by its own answers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/outputLimit.test.js
//
// An OpenAI-style request carries no max_tokens unless the task or the entry
// names one. To a hosted provider that means "the model's own maximum", which
// is why it is left out: a long turn's JSON must not be cut short. llama.cpp,
// LM Studio and Ollama read it the same way.
//
// KoboldCpp does not. It reads the same silence as a small default of its own.
// A player's log shows it: of the answers their KoboldCpp gave to requests that
// named no limit, none is longer than 4,298 characters, and seventeen stop
// between 3,950 and 4,298, whatever the size of the prompt. The Actions task
// was cut mid-word at 4,171 characters and, asked again, at 4,173; five skips
// went to canned events on JSON that stops partway. The one caller that does
// name a limit, the advisor, got 24,069 characters out of the same server.
//
// So a KoboldCpp server is told a limit when nothing else names one
// (contextWindow.js: LOCAL_OUTPUT_LIMIT_TOKENS, outputLimitFor), and ONLY a
// KoboldCpp server. On the others a limit could only cut short an answer that
// completes today.
//
// Which server is KoboldCpp is read off its own answers, so it costs no
// request. Its OpenAI-compatible replies name their model "koboldcpp/<name>",
// whole bodies and stream chunks alike and whatever model the request asked
// for, and its stream chunks carry the id "koboldcpp". Its /v1/models lists the
// same name, so an entry whose model was discovered there, or typed in from
// it, says so before the first request.
//
// What is learned is kept by the server's origin, for the session and in the
// storage handed in, so it is learned once per install. The first request ever
// made to a KoboldCpp server under some other model name therefore goes out
// with no limit; an answer cut short there is reported as one stopped at its
// output limit and is not asked for again (providerErrors.js
// OUTPUT_LIMIT_MESSAGE). It is unlearned the same way it is learned: an answer
// from a remembered origin that names any other model is a different server on
// that address now, and one a limit must not be sent to.
//
// Import-free, like contextWindow.js: the caller hands in where the memory is
// kept, so this runs under bare node.

export const KOBOLDCPP_SERVERS_KEY = "ai_koboldcpp_servers";

const KOBOLDCPP_MODEL = /^koboldcpp\//i;
const KOBOLDCPP_CHUNK_ID = "koboldcpp";

// A model name KoboldCpp gave: what its /v1/models lists and its answers carry.
export const isKoboldCppModel = (model) => typeof model === "string" && KOBOLDCPP_MODEL.test(model.trim());

// What one answer says about the server it came from: true (KoboldCpp), false
// (it names some other model, so some other server), or null (nothing either
// way: no model named, or not an answer at all). `answer` is a whole body, the
// envelope a stream was reassembled into (streamAssembly.js keeps the chunks'
// model and id on it), or a single stream chunk.
export const koboldCppVerdict = (answer) => {
    if (!answer || typeof answer !== "object") return null;
    const model = typeof answer.model === "string" ? answer.model.trim() : "";
    if (isKoboldCppModel(model)) return true;
    if (typeof answer.id === "string" && answer.id.trim().toLowerCase() === KOBOLDCPP_CHUNK_ID) return true;
    return model ? false : null;
};

export const isKoboldCppAnswer = (answer) => koboldCppVerdict(answer) === true;

// The server an endpoint address belongs to: its scheme, host and port. An
// address that is no URL is keyed by what was typed, up to its path.
export const serverOrigin = (endpoint) => {
    const address = String(endpoint ?? "").trim();
    if (!address) return "";
    try {
        const url = new URL(address);
        if (url.protocol === "http:" || url.protocol === "https:") return url.origin.toLowerCase();
    } catch { /* not a URL */ }
    return address.toLowerCase().replace(/[/?#].*$/, "");
};

// Which servers are KoboldCpp. `storage` is anything with getItem/setItem, or
// nothing at all (a node test, a browser that refuses storage): the memory is
// then for this session only. Every reach into it is guarded.
export const createKoboldCppMemory = (storage = null) => {
    const origins = new Set();
    let loaded = false;

    // On first use, not at creation: the storage may be installed later than
    // the module that holds this memory is loaded.
    const load = () => {
        if (loaded) return;
        loaded = true;
        try {
            const stored = JSON.parse(storage?.getItem?.(KOBOLDCPP_SERVERS_KEY) || "[]");
            for (const origin of Array.isArray(stored) ? stored : []) {
                if (typeof origin === "string" && origin) origins.add(origin);
            }
        } catch { /* unreadable: this session only */ }
    };
    const save = () => {
        try { storage?.setItem?.(KOBOLDCPP_SERVERS_KEY, JSON.stringify([...origins])); } catch { /* this session only */ }
    };

    const has = (endpoint) => {
        const origin = serverOrigin(endpoint);
        if (!origin) return false;
        load();
        return origins.has(origin);
    };
    // Both return whether anything changed, so the caller can say it once.
    const remember = (endpoint) => {
        const origin = serverOrigin(endpoint);
        if (!origin || has(endpoint)) return false;
        origins.add(origin);
        save();
        return true;
    };
    const forget = (endpoint) => {
        if (!has(endpoint)) return false;
        origins.delete(serverOrigin(endpoint));
        save();
        return true;
    };

    return {
        has,
        remember,
        forget,
        // What one answer from `endpoint` teaches: "learned" (it is KoboldCpp, and
        // that is news), "unlearned" (it was thought to be, and names another
        // model now), or "" when nothing changed.
        hear(endpoint, answer) {
            const verdict = koboldCppVerdict(answer);
            if (verdict === true) return remember(endpoint) ? "learned" : "";
            if (verdict === false) return forget(endpoint) ? "unlearned" : "";
            return "";
        },
    };
};

const positive = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
};

// The limit a request carries as its log line states it: the figure and whose
// it is, so a report shows what the model was working under and who set it.
// Handed in as the request has them (contextWindow.js works them out): the
// entry's own custom parameter, which is spread into the request last and so
// is the one in force; the task's budget, with the room the request adds to it
// for reasoning; and what the game adds for a KoboldCpp server when neither of
// those names a limit.
export const describeOutputLimit = ({ entryTokens = 0, taskTokens = 0, reasoningHeadroom = 0, gameTokens = 0 } = {}) => {
    if (positive(entryTokens)) return `${positive(entryTokens)} (set on the entry)`;
    const task = positive(taskTokens);
    const headroom = positive(reasoningHeadroom);
    if (task && headroom) return `${task + headroom} (the task's own ${task}, with ${headroom} of room for reasoning)`;
    if (task) return `${task} (the task's own)`;
    if (positive(gameTokens)) return `${positive(gameTokens)} (set by the game: a KoboldCpp server, and nothing else named one)`;
    return "(provider maximum)";
};
