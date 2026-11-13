/*! Open Historia — a scenario's rules, in short, for the tasks that answer in a line © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/rulesDigest.test.js
//
// A scenario's rules go into most of the game's requests whole. A long
// scenario's are long: one player's 1989 game has 92,000 characters of them,
// some 30,000 tokens. A time skip needs every line. A task that reads one order
// into a command, writes a few posts, weighs a spy's report or says how far a
// goal has come answers in a line or two, and is sent the same 30,000 tokens.
//
// A hosted provider reads them from its cache at a tenth of the price, once any
// request has put them there. A local server reads them from its own cache only
// when the request opens the same from its first token, and a model's template
// may put the task's functions before the system prompt (the Qwen family's
// does): measured on llama.cpp (2026-11-13), one changed value in a declared
// function and the same system prompt after it was read again whole. There
// every such task reads the rules again, a minute or more at a 27B model's pace
// for an answer of one line.
//
// With "Small tasks get the rules in short" on (Settings, AI; off by default),
// those tasks are given a digest of the rules instead: the era, what cannot
// happen, who the powers are, how things are named, in at most 5,000 characters.
// It is written by the model, once for a text of rules (one request, made in
// the background after the first such task, which still gets the rules whole),
// and kept in this browser under the rules' fingerprint, so a scenario edited
// since is digested again.
//
// OFF by default: a digest leaves things out, and which of them a small task
// needed is not known until it answers worse. The time skip, the scenes and
// every conversation always get the rules whole.
//
// Import-free rules and shapes; gameplay.js asks for the digest and keeps it.

export const RULES_DIGEST_KEY = "oh_ai_rules_digests";
// The tasks whose answer is a line or two.
export const DIGEST_TASKS = Object.freeze(new Set(["descriptionToAction", "rostraFeed", "spyIntercept", "goalProgress"]));
// Rules shorter than this are sent whole: there is little to save.
export const MIN_RULES_CHARS = 12000;
export const DIGEST_MAX_CHARS = 5000;
// An answer shorter than this is no digest (a refusal, a preface with nothing after it).
const DIGEST_MIN_CHARS = 400;
// How many texts of rules a browser keeps digests for.
const MAX_KEPT = 6;

const textOf = (value) => (typeof value === "string" ? value : "");
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// A text of rules, told from any other: its length and a hash of all of it.
export const rulesFingerprint = (rules) => {
    const text = textOf(rules);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${text.length}-${(hash >>> 0).toString(36)}`;
};

// The digests kept, by fingerprint; the oldest goes when there are too many.
export const createRulesDigestMemory = (storage, { max = MAX_KEPT } = {}) => {
    let held = null;
    const all = () => {
        if (!held) {
            held = {};
            try {
                const stored = JSON.parse(storage?.getItem(RULES_DIGEST_KEY) ?? "{}");
                if (isRecord(stored)) for (const [key, value] of Object.entries(stored)) if (textOf(value)) held[key] = value;
            } catch { /* nothing kept, or not ours */ }
        }
        return held;
    };
    return {
        get: (fingerprint) => textOf(all()[fingerprint]),
        set: (fingerprint, digest) => {
            const text = textOf(digest).trim();
            if (!fingerprint || !text) return;
            const kept = all();
            delete kept[fingerprint];
            kept[fingerprint] = text;
            for (const key of Object.keys(kept).slice(0, Math.max(0, Object.keys(kept).length - max))) delete kept[key];
            try { storage?.setItem(RULES_DIGEST_KEY, JSON.stringify(kept)); } catch { /* storage refused: kept for this session */ }
        },
    };
};

const digests = (taskKey, rules, enabled) => Boolean(enabled) && DIGEST_TASKS.has(textOf(taskKey)) && textOf(rules).length >= MIN_RULES_CHARS;

// What a task is given as the scenario's rules: the digest where the setting is
// on, the task is one of the small ones and a digest of exactly these rules is
// kept; the rules themselves in every other case.
export const rulesForTask = ({ taskKey = "", rules = "", enabled = false, memory = null } = {}) => {
    if (!digests(taskKey, rules, enabled)) return textOf(rules);
    const digest = memory?.get(rulesFingerprint(rules)) ?? "";
    return digest
        ? `(The scenario's rules in short, for this task. The full text governs the game and is not repeated here.)\n${digest}`
        : textOf(rules);
};

// The rules also reach a prompt written out inside other variables (the world
// summary's "Simulation rules:" line, promptContext.js). A task given the
// digest was still sent them whole that way: 158,113 characters of system
// prompt with a 4,172-character digest at its head (2026-11-13). So where the
// digest is given, every other variable that holds the whole text has it
// replaced by a line that says where the rules are. Returns how many were changed.
export const RULES_ELSEWHERE_NOTE = "(the scenario's rules are given in short elsewhere in this prompt)";
export const shortenRulesElsewhere = (variables, whole, given) => {
    const text = textOf(whole).trim();
    if (!variables || typeof variables !== "object" || text.length < MIN_RULES_CHARS || textOf(given) === textOf(whole)) return 0;
    let changed = 0;
    for (const [key, value] of Object.entries(variables)) {
        if (key === "simulationRules" || typeof value !== "string" || !value.includes(text)) continue;
        variables[key] = value.split(text).join(RULES_ELSEWHERE_NOTE);
        changed++;
    }
    return changed;
};

// Is a digest of these rules still to be written?
export const digestIsDue = ({ taskKey = "", rules = "", enabled = false, memory = null } = {}) =>
    digests(taskKey, rules, enabled) && !(memory?.get(rulesFingerprint(rules)) ?? "");

// The request that writes one. i18n-ignore: the model's briefing, never shown.
export const buildDigestRequest = (rules) => ({
    systemPrompt: [
        "You prepare a short reference for a strategy game's helper tasks. Below, between the markers, are the full rules of the scenario being played.",
        `Write a digest of them in at most ${DIGEST_MAX_CHARS} characters, in the language the rules are written in, for helpers that each do one small job: `
            + "reading a player's order into a command, writing a few posts of a social feed, weighing a spy's report, saying how far a goal has come.",
        "Keep, in the rules' own terms: when and where the scenario is set and its starting date; the tone and realism it asks for; "
            + "the hard limits (what cannot happen, what must not be invented, what is fixed); the main powers, blocs and leaders by the names the rules use; "
            + "how places, people and institutions are to be named, and in what language answers are written.",
        "Leave out step-by-step procedures for simulating a period, long tables, and examples. Plain paragraphs or short lists; no preface, no closing remark, nothing but the digest.",
        "[RULES BEGIN]",
        textOf(rules),
        "[RULES END]",
    ].join("\n\n"),
    userMessage: "Write the digest now.",
});

// The model's answer as a digest, or "" where it is none: too short, or no
// shorter than half the rules it was to shorten. Cut at a paragraph's end where
// it runs over.
export const readDigestAnswer = (answer, { rules = "", maxChars = DIGEST_MAX_CHARS } = {}) => {
    const text = textOf(answer).replace(/\r\n/g, "\n").trim();
    if (text.length < DIGEST_MIN_CHARS) return "";
    if (textOf(rules) && text.length > textOf(rules).length / 2) return "";
    if (text.length <= maxChars) return text;
    const cut = text.slice(0, maxChars);
    const paragraph = cut.lastIndexOf("\n");
    return (paragraph >= maxChars / 2 ? cut.slice(0, paragraph) : cut).trimEnd();
};
