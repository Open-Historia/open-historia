/*! Open Historia — call-time directive de-duplication © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Deciding whether a call-time directive still needs to be appended, or whether
// the rendered prompt already says it.
//
// Why this exists: several rules are concatenated onto the system prompt in
// runJsonTask rather than living in defaultPrompts.json, because existing
// campaigns carry a FROZEN copy of their prompt pack and a JSON edit never
// reaches them (see docs/ai-prompts.md §2). That works, but a game seeded from a
// current default then carries the rule in its template AND gets it appended
// again — paying twice for it on every jump.
//
// The waste is the smaller half of the problem. The same rule in two slightly
// different wordings invites the model to look for a distinction that is not
// there, which is the opposite of what a duplicated safety rule is for.
//
// DELIBERATELY IMPORT-FREE, like jumpSegments.js and jsonSalvage.js: the
// consequence of getting this wrong is asymmetric and invisible at runtime — a
// false negative merely restores today's harmless duplicate, but a false
// positive silently DELETES a rule from the prompt and nothing downstream would
// report it. That asymmetry is exactly what wants direct tests, and gameplay.js
// reaches the whole browser runtime and cannot be tested at all.

/**
 * Does `renderedPrompt` already contain `marker`?
 *
 * Whitespace-collapsed and case-insensitive, so a scenario author who reflowed
 * the paragraph or changed its capitalisation still counts as having the rule.
 * Deliberately nothing cleverer: markers are chosen to be long and specific
 * rather than fuzzy-matched, because the cost of a wrong "yes" is a missing rule.
 */
export const templateAlreadySays = (renderedPrompt, marker) => {
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const haystack = normalize(renderedPrompt);
    const needle = normalize(marker);
    // An empty marker matches everything, which would drop the directive it
    // guards on every call. Treat it as "not present" instead.
    if (!haystack || !needle) return false;
    return haystack.includes(needle);
};

// The opening claim of the units contract. Chosen because it is the one sentence
// the bundled template and the [Units on the Map] directive share verbatim, and
// no other directive says it.
export const UNIT_CONTRACT_MARKER = "Units are EVIDENCE OF YOUR OWN EVENTS";
