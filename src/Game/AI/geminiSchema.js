/*! Open Historia — JSON Schema to Gemini function-declaration schema © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Gemini's functionDeclarations take an OpenAPI 3.0 SUBSET, not JSON Schema, and
// it rejects the whole request — 400 "Request contains an invalid argument" — for
// anything outside that subset. Nothing in the reply says which field was wrong,
// so a single bad keyword anywhere in a 62 KB declaration reads to the player as
// "the time skip is broken".
//
// The field report this exists for: EVERY timeline jump on Gemini failed, because
// JUMP_FORWARD_SCHEMA carries `catalyst: anyOf[catalystSchema, {type: "null"}]`
// (gameplaySchemas.js, nullableCatalystSchema) and Gemini's Schema.type enum has
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

// A branch that exists only to say "or null". It may carry a description as well
// (idleDiplomacy writes `{type: "null", description: "No polity would plausibly
// reach out right now."}`), which is a genuine instruction to the model and is
// folded into the surviving branch below rather than dropped.
const isNullBranch = (value) => isObject(value) && value.type === "null";

const describe = (value) => (typeof value?.description === "string" ? value.description.trim() : "");

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

    if (Array.isArray(converted.anyOf)) {
        const survivors = converted.anyOf.filter((branch) => !isNullBranch(branch));
        if (survivors.length !== converted.anyOf.length) {
            const nullBranch = converted.anyOf.find(isNullBranch);
            const { anyOf: _anyOf, ...rest } = converted;

            // One real branch (the common case: catalyst, chat, sighting) — lift it
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
