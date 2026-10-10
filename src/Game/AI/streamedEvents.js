// A skip's request already streams (streamAssembly.js), for keep-alive and for
// Cancel. This reads the tokens on their way past and hands back each events[i]
// object the moment it is whole, so the panel fills as the model writes.
//
// A PREVIEW only: these are the model's raw words, before the validators sort,
// clamp and screen them. The turn that lands is the turn that would have landed
// with nobody watching, and a half-written event is never emitted.
//
// Two input shapes, because providers stream a tool call two ways:
//   pushJson  partial JSON text (OpenAI-compatible, Anthropic, and a Gemini
//             skip asked for as JSON text: main.jsx callGemini)
//   pushArgs  the object assembled from Vertex AI partialArgs path fragments
//
// The text is read as leniently as the finished answer will be
// (jsonSalvage.js): a model that writes a key without its quotes, or leaves a
// comment in, still has its events shown as they close.
//
// Out of gameplay.js and free of the game's runtime, so it runs under bare
// node, like jsonSalvage.js (its one import) and providerErrors.js.
import { parseLooseJson } from "./jsonSalvage.js";

// A word that could be an unquoted key.
const BARE_WORD_CHAR = /[A-Za-z0-9_$]/;

// "$.events[0].title" and "$['events'][0].title" both give ["events", 0, "title"].
// An index is a number and a name a string, so the assembler can tell an array
// from an object without a schema.
export const parseJsonPathSteps = (path) => {
    const raw = String(path ?? "").trim();
    const steps = [];
    let at = raw.startsWith("$") ? 1 : 0;
    while (at < raw.length) {
        const char = raw[at];
        if (char === ".") { at += 1; continue; }
        if (char === "[") {
            at += 1;
            const quote = raw[at] === "'" || raw[at] === '"' ? raw[at] : "";
            if (quote) {
                at += 1;
                let name = "";
                while (at < raw.length && raw[at] !== quote) {
                    if (raw[at] === "\\" && at + 1 < raw.length) at += 1;
                    name += raw[at];
                    at += 1;
                }
                steps.push(name);
                at += 1;
                if (raw[at] === "]") at += 1;
                continue;
            }
            let inner = "";
            while (at < raw.length && raw[at] !== "]") { inner += raw[at]; at += 1; }
            if (raw[at] === "]") at += 1;
            inner = inner.trim();
            steps.push(/^-?\d+$/.test(inner) ? Number(inner) : inner);
            continue;
        }
        let name = "";
        while (at < raw.length && raw[at] !== "." && raw[at] !== "[") { name += raw[at]; at += 1; }
        if (name) steps.push(name);
    }
    return steps;
};

// The four value fields are a protobuf oneof, so a set one is always on the wire
// even at its default. Nothing set means the fragment carries no value.
export const partialArgValue = (fragment) => {
    if (typeof fragment?.stringValue === "string") return fragment.stringValue;
    if (typeof fragment?.numberValue === "number") return fragment.numberValue;
    if (typeof fragment?.boolValue === "boolean") return fragment.boolValue;
    if (fragment?.nullValue !== undefined && fragment?.nullValue !== null) return null;
    return undefined;
};

// Writes one fragment in, creating the objects and arrays its path implies.
// `append` continues a string the previous fragment left open.
export const setAtJsonPath = (root, steps, value, { append = false } = {}) => {
    if (!root || typeof root !== "object" || !steps.length) return root;
    let node = root;
    for (let index = 0; index < steps.length - 1; index += 1) {
        const step = steps[index];
        const childIsIndexed = typeof steps[index + 1] === "number";
        const existing = node[step];
        if (!existing || typeof existing !== "object") node[step] = childIsIndexed ? [] : {};
        node = node[step];
    }
    const last = steps[steps.length - 1];
    if (append && typeof node[last] === "string" && typeof value === "string") node[last] += value;
    else node[last] = value;
    return root;
};

const clone = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
};

// onEvent(event, { index }) fires once per complete event, in written order,
// never twice for the same index. A throwing listener costs the listener only.
export const createStreamedEventReader = ({ key = "events", onEvent = null } = {}) => {
    let emitted = 0;

    const emit = (value, index) => {
        if (index + 1 > emitted) emitted = index + 1;
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        if (typeof onEvent !== "function") return;
        try { onEvent(value, { index }); } catch { /* a preview must not break the stream */ }
    };

    // Text scanning state. The scan keeps its place between pushes.
    let text = "";
    let at = 0;
    let started = false;        // the opening brace of the arguments was seen
    let depth = 0;              // open containers, the arguments object being 1
    let inString = false;
    let escaped = false;
    let closedString = "";      // the last string literal that closed
    let bareWord = "";          // the last unquoted word, in case it is a key
    let bareOpen = false;       // that word is still being read
    let lastKey = "";           // either of them, once a ':' proved it was a key
    let stringStart = -1;
    let arrayDepth = -1;        // depth inside the events array, once found
    let elementStart = -1;
    let elementIndex = 0;
    let arrayDone = false;

    const scan = () => {
        while (at < text.length) {
            const char = text[at];
            if (inString) {
                if (escaped) escaped = false;
                else if (char === "\\") escaped = true;
                else if (char === '"') {
                    inString = false;
                    closedString = text.slice(stringStart + 1, at);
                    bareWord = "";
                }
                at += 1;
                continue;
            }
            if (char === '"') { inString = true; escaped = false; stringStart = at; bareOpen = false; at += 1; continue; }
            // A comment a model left in is not part of the answer, and a quote
            // or a brace inside one must not be read as structure. Its end may
            // not have arrived yet: the scan waits for it.
            if (char === "/") {
                if (at + 1 >= text.length) return;
                if (text[at + 1] === "/") {
                    const lineEnd = text.indexOf("\n", at);
                    if (lineEnd === -1) return;
                    at = lineEnd + 1;
                    continue;
                }
            }
            if (char === ":") { lastKey = closedString || bareWord; closedString = ""; bareWord = ""; bareOpen = false; at += 1; continue; }
            if (char === "{" || char === "[") {
                bareWord = ""; bareOpen = false;
                // Prose, a fence or a sentinel before the object is skipped, not parsed.
                if (!started) {
                    if (char !== "{") { at += 1; continue; }
                    started = true;
                }
                // Both tests read the depth the container opens at, before it counts.
                // Matched only at the top level, so a nested `events` key cannot capture the scan.
                if (char === "[" && arrayDepth < 0 && !arrayDone && depth === 1 && lastKey === key) arrayDepth = depth + 1;
                else if (char === "{" && arrayDepth === depth && elementStart < 0) elementStart = at;
                depth += 1;
                lastKey = "";
                closedString = "";
                at += 1;
                continue;
            }
            if (char === "}" || char === "]") {
                bareWord = ""; bareOpen = false;
                if (!started) { at += 1; continue; }
                if (char === "}" && arrayDepth === depth - 1 && elementStart >= 0) {
                    const written = text.slice(elementStart, at + 1);
                    let parsed = null;
                    try { parsed = JSON.parse(written); } catch { parsed = parseLooseJson(written); }
                    // Every closed element takes its own index, so an unreadable one costs only itself.
                    emit(parsed, elementIndex);
                    elementIndex += 1;
                    elementStart = -1;
                }
                depth -= 1;
                if (char === "]" && arrayDepth === depth + 1) { arrayDepth = -1; arrayDone = true; }
                lastKey = "";
                closedString = "";
                at += 1;
                continue;
            }
            // An unquoted word, kept until it is known whether a ':' follows it.
            if (BARE_WORD_CHAR.test(char)) {
                bareWord = bareOpen ? bareWord + char : char;
                bareOpen = true;
            } else {
                bareOpen = false;
                if (char === ",") bareWord = "";
            }
            at += 1;
        }
    };

    // Path assembly state.
    let args = null;
    let reached = -1;           // the highest events index any fragment has named

    // A path stream marks the end of an event only by starting the next one.
    const releaseSettled = (upTo) => {
        const list = Array.isArray(args?.[key]) ? args[key] : [];
        for (let index = emitted; index < upTo && index < list.length; index += 1) {
            emit(clone(list[index]), index);
        }
    };

    return {
        pushJson(soFar) {
            const next = String(soFar ?? "");
            // Cheap per frame on purpose: a jump's arguments run to hundreds of
            // kilobytes, so comparing the whole string would cost more than the
            // generation. A shorter string, or one opening differently, is a new call.
            if (next.length < text.length || (text && !next.startsWith(text.slice(0, 32)))) {
                text = next;
                at = 0; started = false; depth = 0; inString = false; escaped = false;
                closedString = ""; bareWord = ""; bareOpen = false; lastKey = ""; stringStart = -1;
                arrayDepth = -1; elementStart = -1; elementIndex = 0; arrayDone = false;
            } else {
                text = next;
            }
            scan();
        },
        pushArgs(nextArgs, paths) {
            if (!nextArgs || typeof nextArgs !== "object") return;
            // A different arguments object is a different call: a lookup round, or a retry.
            if (args && nextArgs !== args) { reached = -1; emitted = 0; }
            args = nextArgs;
            for (const path of Array.isArray(paths) ? paths : []) {
                const steps = parseJsonPathSteps(path);
                if (steps[0] !== key || typeof steps[1] !== "number") continue;
                if (steps[1] > reached) reached = steps[1];
            }
            releaseSettled(reached);
        },
        finish() {
            // A cut-off text stream has nothing more to give; a path stream has one event held back.
            releaseSettled(Array.isArray(args?.[key]) ? args[key].length : 0);
        },
        get count() { return emitted; },
    };
};
