/*! Open Historia — structured-output mode selection © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// WHICH WAY to ask a model for structured data, and learning which way actually
// works for the endpoint in front of you.
//
// There are four, in descending order of how strongly the answer is guaranteed:
//
//   tool         "call this function with these arguments" — the provider
//                enforces the schema. Best, and the default first choice.
//   json_schema  "reply with JSON matching this schema" — provider-validated.
//   json_object  "reply with valid JSON" — loosely enforced.
//   text_json    the schema pasted into the prompt — nothing enforces it at all,
//                it is simply asked for.
//
// callOpenAIStyleChatCompletions walks that list downward when a rung fails, and
// that ladder is what stopped a badly-behaved endpoint from costing the player
// whole turns. But it starts from the top on EVERY call, so it rediscovers the
// same failure over and over: on one measured 1-year turn, seven separate ladder
// walks accounted for ~740 of 1419 seconds, all of it re-learning that an NVIDIA
// endpoint accepts tool_choice:"required" and then does not enforce it.
//
// The obvious fix — silently remember and skip — was considered and rejected.
// It trades correctness for speed on a guess about someone else's server: one
// unrelated blip would demote every later call out of the strongest channel, and
// the degradation would be invisible. Instead the ladder OBSERVES, and once it
// has seen the same answer twice it offers the player the setting. The app does
// the discovery; the player makes the decision.
//
// DELIBERATELY IMPORT-FREE, like providerErrors.js and jsonSalvage.js: the
// promotion rule is small, consequential, and exactly the kind of thing that
// wants direct tests. main.jsx cannot be unit-tested at all.

// Strongest first. Index order IS the ladder.
export const STRUCTURED_MODES = ["tool", "json_schema", "json_object", "text_json"];

// PLAIN LANGUAGE, DELIBERATELY.
//
// Nobody should need to know what JSON is to use this setting. The only thing a
// player actually has to understand is: leave it on Auto, and say yes if the
// game offers to speed things up. The technical names are kept only because they
// are what a provider's own documentation calls these, so someone genuinely
// troubleshooting can match them up — every one is paired with a sentence about
// WHEN you would pick it, never about what it is.
export const STRUCTURED_MODE_LABELS = {
    auto: "Automatic (recommended)",
    tool: "Tool calling",
    json_schema: "JSON schema",
    json_object: "JSON object",
    text_json: "Plain text",
};

// The one line under the dropdown, whatever is selected. Says the only thing
// most people need.
export const STRUCTURED_MODE_INTRO =
    "How the game asks your AI for answers it can read. Leave this on Automatic — "
    + "the game works out what your model supports, and will offer to speed things "
    + "up if it finds a better fit.";

// Each option: when you would choose it, not what it is. The note about changing
// model is there because changing it DOES reset this (setProviderField) — without
// saying so, that reads as the game forgetting a setting.
export const STRUCTURED_MODE_HINTS = {
    auto: "The game tries the best method first and falls back if your model can't use it. Right for almost everyone.",
    tool: "For models that follow instructions strictly. Most paid models do. Changing your model resets this to Automatic.",
    json_schema: "For models that struggle with the strictest method. Common on free and self-hosted models. Changing your model resets this to Automatic.",
    json_object: "For older or simpler models. Changing your model resets this to Automatic.",
    text_json: "Last resort, for models that can't manage anything stricter. Changing your model resets this to Automatic.",
};

export const DEFAULT_STRUCTURED_MODE = "auto";

export const normalizeStructuredMode = (value) => {
    const mode = String(value ?? "").trim().toLowerCase();
    if (mode === "auto" || mode === "") return "auto";
    return STRUCTURED_MODES.includes(mode) ? mode : "auto";
};

/**
 * Where a call should START on the ladder.
 *
 * A configured mode is a STARTING POINT, never a lock: the caller may still walk
 * downward from it if the endpoint changes or the player picked wrong. Anything
 * else would let a setting chosen months ago permanently break a campaign.
 */
export const startingStructuredMode = (configured) => {
    const mode = normalizeStructuredMode(configured);
    return mode === "auto" ? "tool" : mode;
};

// The next rung down, or null at the bottom.
export const nextStructuredMode = (mode) => {
    const index = STRUCTURED_MODES.indexOf(mode);
    if (index === -1 || index === STRUCTURED_MODES.length - 1) return null;
    return STRUCTURED_MODES[index + 1];
};

// Two, not one. A single drop can be a blip — an overloaded moment, one awkward
// prompt — and suggesting a permanent setting change off one data point is the
// same guessing the rejected memo did, just with a dialog attached. Two in a
// session is a pattern. On the measured turn above this fires after the second
// segment, still saving the remaining segments and the projects call.
export const SUGGEST_AFTER_OBSERVATIONS = 2;

/**
 * Track what the ladder discovers, and decide when it is worth asking.
 *
 * `key` identifies the endpoint being learned about — provider plus model, since
 * the same provider can serve one model that tool-calls and one that does not.
 */
export const createModeObserver = () => {
    const observations = new Map(); // key -> { mode, count }
    const declined = new Set();     // key|mode the player has already said no to

    return {
        /**
         * A call started at `startedAt` and eventually succeeded at `landedAt`.
         * Only a genuine DROP teaches anything: succeeding where we began is the
         * expected case and says nothing new.
         */
        record(key, startedAt, landedAt) {
            if (!key || startedAt === landedAt) return null;
            if (!STRUCTURED_MODES.includes(landedAt)) return null;
            const prior = observations.get(key);
            // A different landing spot resets the count rather than accumulating
            // across contradictory evidence: two drops to two different rungs is
            // not a pattern, it is noise.
            const count = prior && prior.mode === landedAt ? prior.count + 1 : 1;
            observations.set(key, { mode: landedAt, count });
            return { mode: landedAt, count };
        },

        /**
         * Should the player be asked to make `landedAt` their starting point?
         * Only when it has been seen enough times, they have not already declined
         * it, and they are not already set to it.
         */
        shouldSuggest(key, configured) {
            const seen = observations.get(key);
            if (!seen || seen.count < SUGGEST_AFTER_OBSERVATIONS) return null;
            if (declined.has(`${key}|${seen.mode}`)) return null;
            if (normalizeStructuredMode(configured) === seen.mode) return null;
            return seen.mode;
        },

        // "No thanks" — remembered so it does not ask again every turn.
        decline(key, mode) {
            declined.add(`${key}|${mode}`);
        },

        // Accepting settles it; forget the observations so a later change of
        // provider behaviour is learned fresh rather than compared against stale
        // evidence.
        clear(key) {
            observations.delete(key);
        },
    };
};
