/*! Open Historia — JSON Schema to Gemini function-declaration schema © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Gemini's functionDeclarations take an OpenAPI 3.0 SUBSET, not JSON Schema, and
// it rejects the whole request — 400 "Request contains an invalid argument" — for
// anything outside that subset. Nothing in the reply says which field was wrong,
// so a single bad keyword anywhere in a 62 KB declaration reads to the player as
// "the time skip is broken".
//
// The field report this exists for: EVERY timeline jump on Gemini failed, because
// JUMP_FORWARD_SCHEMA then carried a nullable scene, `anyOf[sceneSchema, {type: "null"}]`
// (gameplaySchemas.js), and Gemini's Schema.type enum has
// no `null` member — STRING, NUMBER, INTEGER, BOOLEAN, ARRAY, OBJECT and nothing
// else. Nullability there is the separate `nullable: true` flag. idleDiplomacy
// carries the same shape on `chat` and `sighting`, so unprompted diplomacy was
// silently broken on Gemini too.
//
// Kept import-free and separate from main.jsx (which pulls in the whole browser
// runtime and so cannot be unit-tested at all) for the same reason as
// jsonSalvage.js, providerErrors.js and regionVocab.js — see geminiSchema.test.js,
// whose real job is walking every live GAMEPLAY_SCHEMAS entry so the next schema
// that reaches for `type: "null"` fails a test instead of a player's turn.

// Keywords Gemini has no field for. Sent anyway, they are "unknown name" errors.
const DROPPED_KEYS = new Set(["additionalProperties", "$schema"]);

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Array-length bounds on an array of OBJECTS: a shape Gemini refuses, found the
// same way as the `type: "null"` one. First (2026-09-17) inside an `anyOf`
// branch — every request carrying the chat action batch came back 400 until
// they were gone — and the bounds outside a union were thought fine, since the
// scene's `choices` in the jump's answer always worked. Then (2026-09-21) the
// pregame declaration came back 400 on every model in the list, with no union
// in it at all: `events` (objects, 1-12) and `canonicalUpdates` (objects, up to
// 32). Bisected live, removing ANY ONE of those bounds made the identical
// request pass, and the same declaration had been accepted a week earlier. It
// is not a per-field rule, then, but a ceiling on how large the constrained
// grammar gets once an object array is unrolled N times — and one that moves.
//
// They are a hint to the model either way: `validateGameplayPayload` is what
// actually enforces a count, and it runs on the answer whatever the provider
// was told. So on every array of objects, at any depth, they are dropped and
// the field's own description carries the requirement in words. An array of
// strings keeps its bounds: those Gemini takes, and they unroll to nothing.
// An array whose ITEMS are objects — `items.type === "object"`, or items with
// properties of their own.
const holdsObjects = (items) => isObject(items) && (items.type === "object" || isObject(items.properties));
const boundsInWords = (min, max) => {
    const entries = (count) => `${count} entr${count === 1 ? "y" : "ies"}`;
    if (min !== undefined && max !== undefined) return min === max ? `Exactly ${entries(min)}.` : `Between ${min} and ${entries(max)}.`;
    if (min !== undefined) return `At least ${entries(min)}.`;
    return `At most ${entries(max)}.`;
};
// The node with its bounds moved from keywords into its description. Only for
// an array of objects; anything else comes back as it was.
const dropObjectArrayBounds = (node) => {
    if (!isObject(node) || !holdsObjects(node.items)) return node;
    const min = Number.isFinite(node.minItems) ? node.minItems : undefined;
    const max = Number.isFinite(node.maxItems) ? node.maxItems : undefined;
    if (min === undefined && max === undefined) return node;
    const { minItems: _min, maxItems: _max, ...rest } = node;
    const words = boundsInWords(min, max);
    const description = describe(rest);
    return { ...rest, description: description ? (description.includes(words) ? description : `${description} ${words}`) : words };
};
const stripArrayBounds = (value) => {
    if (Array.isArray(value)) return value.map(stripArrayBounds);
    if (!isObject(value)) return value;
    const next = {};
    for (const [key, entry] of Object.entries(value)) next[key] = stripArrayBounds(entry);
    return dropObjectArrayBounds(next);
};

// A branch that exists only to say "or null". It may carry a description as well
// (idleDiplomacy writes `{type: "null", description: "No polity would plausibly
// reach out right now."}`), which is a genuine instruction to the model and is
// folded into the surviving branch below rather than dropped.
const isNullBranch = (value) => isObject(value) && value.type === "null";

function describe(value) { return typeof value?.description === "string" ? value.description.trim() : ""; }

// Fold "or null" back into the one branch that survives, keeping both
// descriptions: with the null branch gone, the note explaining WHEN to answer
// null is the only thing left telling the model that silence is an option.
const mergeDescriptions = (survivor, nullBranch) => {
    const kept = describe(survivor);
    const note = describe(nullBranch);
    if (!note || kept.includes(note)) return kept ? { description: kept } : {};
    return { description: kept ? `${kept} Answer null instead when: ${note}` : note };
};

export function toGeminiSchema(value) {
    if (Array.isArray(value)) return value.map(toGeminiSchema);
    if (!isObject(value)) return value;

    const converted = {};
    for (const [key, entry] of Object.entries(value)) {
        if (DROPPED_KEYS.has(key)) continue;
        converted[key] = toGeminiSchema(entry);
    }

    // `type: ["object", "null"]` — the other spelling of a nullable field. Not
    // currently produced by any gameplay schema, but it costs two lines to accept
    // and it is the shape someone reaches for next.
    if (Array.isArray(converted.type)) {
        const types = converted.type.filter((entry) => entry !== "null");
        if (types.length !== converted.type.length) converted.nullable = true;
        // Gemini takes ONE type; a genuine multi-type union would need anyOf, which
        // no schema here uses. Keep the first so the field still declares something.
        converted.type = types[0] ?? "string";
    }

    // An array of objects carries its length bounds in words (see above), at
    // every depth: this runs on the way back up, so a nested array has already
    // been converted by the time its parent is looked at.
    if (converted.type === "array" && holdsObjects(converted.items)) {
        const worded = dropObjectArrayBounds(converted);
        delete converted.minItems;
        delete converted.maxItems;
        if (worded.description) converted.description = worded.description;
    }

    if (Array.isArray(converted.anyOf)) {
        // Every branch of a union, bounds stripped (see stripArrayBounds).
        converted.anyOf = converted.anyOf.map(stripArrayBounds);
        const survivors = converted.anyOf.filter((branch) => !isNullBranch(branch));
        if (survivors.length !== converted.anyOf.length) {
            const nullBranch = converted.anyOf.find(isNullBranch);
            const { anyOf: _anyOf, ...rest } = converted;

            // One real branch (the common case: chat, sighting) — lift it
            // up so Gemini sees a plain nullable object instead of a one-member
            // union. The wrapper's own keys stay, and the branch wins where they
            // collide, since the branch is the actual shape being described.
            if (survivors.length === 1) {
                const survivor = survivors[0];
                return {
                    ...rest,
                    ...survivor,
                    ...mergeDescriptions({ ...rest, ...survivor }, nullBranch),
                    nullable: true,
                };
            }

            // Nothing but null branches: degenerate, and there is no type left to
            // declare. Not reachable from any current schema; kept so a malformed
            // schema still produces a sendable declaration rather than a 400.
            if (survivors.length === 0) {
                return { type: "string", ...rest, ...mergeDescriptions(rest, nullBranch), nullable: true };
            }

            return {
                ...rest,
                anyOf: survivors,
                ...mergeDescriptions(rest, nullBranch),
                nullable: true,
            };
        }
    }

    return converted;
}
