/*! Open Historia — knowing a KoboldCpp server by its own answers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/koboldCpp.test.js
//
// A request that names no output limit means "as much as the model needs" to
// llama.cpp, LM Studio and Ollama. To KoboldCpp it means its own default
// (--defaultgenamt: 512 tokens in 1.90, 1,024 in 1.110, 2,048 in 1.122), and a
// turn's JSON is cut off there. So KoboldCpp, and only KoboldCpp, is sent a
// limit when nobody else named one (contextWindow.js
// LOCAL_OUTPUT_LIMIT_TOKENS). A limit sent to the others would cut answers
// that complete today.
//
// Which server is KoboldCpp, it says itself. Every chat-completions answer
// carries the model's name under KoboldCpp's own prefix, `model:
// "koboldcpp/<name>"`, in a whole body and in each chunk of a stream (builds
// up to about 1.100 also gave every chunk the id `koboldcpp`). Its /v1/models
// lists that same id, so it is also the model a request names when the entry's
// was picked from that list, or left blank and found there. Nothing is asked
// for this: the first answer tells, and the endpoint is remembered by origin,
// for the session and, where there is storage, for the install.
//
// It is forgotten the way it was learned. An answer from a remembered endpoint
// that names a model without the prefix is another server on that address now,
// and that one must not be held to a limit meant for KoboldCpp.
//
// Import-free, with the storage handed in, so the rule is tested; main.jsx
// cannot be.

export const KOBOLDCPP_ENDPOINTS_KEY = "ai_koboldcpp_endpoints";

const MODEL_PREFIX = /^koboldcpp\//i;

// A model name of KoboldCpp's: what its answers carry and its model list offers.
export const isKoboldCppModelName = (model) => typeof model === "string" && MODEL_PREFIX.test(model.trim());

// What one answer says about the server that sent it, a whole chat-completions
// body or one chunk of a stream: true, it is KoboldCpp; false, it names a model
// that is not KoboldCpp's, so it is something else; null, it does not say (an
// error body, a chunk with no model, a keep-alive).
export const saysKoboldCpp = (payload) => {
    if (!payload || typeof payload !== "object") return null;
    if (isKoboldCppModelName(payload.model) || payload.id === "koboldcpp") return true;
    return typeof payload.model === "string" && payload.model.trim() ? false : null;
};

// What a server is remembered by: "http://localhost:5001" for
// "http://localhost:5001/v1". Empty for anything that is not a URL.
export const endpointOriginOf = (endpoint) => {
    try {
        const { origin } = new URL(String(endpoint ?? "").trim());
        return origin && origin !== "null" ? origin : "";
    } catch {
        return "";
    }
};

// The endpoints that have answered as KoboldCpp. `storage` is anything with
// getItem and setItem, or nothing at all (node, a browser that refuses
// storage): then what is learned lasts the session. The stored list is read
// again before every write, so two tabs do not lose each other's endpoints.
export const createKoboldCppMemory = (storage) => {
    const origins = new Set();
    let loaded = false;

    const stored = () => {
        try {
            const parsed = JSON.parse(storage?.getItem?.(KOBOLDCPP_ENDPOINTS_KEY) || "[]");
            return Array.isArray(parsed) ? parsed.filter((origin) => typeof origin === "string" && origin) : [];
        } catch {
            return []; // no storage, or nothing of ours in it
        }
    };
    const write = (list) => {
        try {
            storage?.setItem?.(KOBOLDCPP_ENDPOINTS_KEY, JSON.stringify(list));
        } catch { /* this session only */ }
    };
    const load = () => {
        if (loaded) return;
        loaded = true;
        for (const origin of stored()) origins.add(origin);
    };

    const knows = (endpoint) => {
        const origin = endpointOriginOf(endpoint);
        if (!origin) return false;
        load();
        return origins.has(origin);
    };
    // Both say whether anything changed.
    const learn = (endpoint) => {
        const origin = endpointOriginOf(endpoint);
        if (!origin || knows(endpoint)) return false;
        origins.add(origin);
        write([...new Set([...stored(), origin])]);
        return true;
    };
    const forget = (endpoint) => {
        const origin = endpointOriginOf(endpoint);
        if (!origin || !knows(endpoint)) return false;
        origins.delete(origin);
        write(stored().filter((entry) => entry !== origin));
        return true;
    };

    return {
        knows,
        learn,
        forget,
        // Whether a request to this entry goes to KoboldCpp: its endpoint has
        // answered as one, or the model it is set to is one of KoboldCpp's.
        isKoboldCpp: ({ endpoint, model } = {}) => isKoboldCppModelName(model) || knows(endpoint),
        // One answer's word on its server (saysKoboldCpp). Returns what it
        // changed: "learned", "forgotten", or "" when it changed nothing.
        note: (endpoint, payload) => {
            const said = saysKoboldCpp(payload);
            if (said === null) return "";
            if (said) return learn(endpoint) ? "learned" : "";
            return forget(endpoint) ? "forgotten" : "";
        },
    };
};
