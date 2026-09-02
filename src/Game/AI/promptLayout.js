/*! Open Historia — cache-friendly prompt layout © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Ordering a prompt so the parts that rarely change come FIRST.
//
// THE PROBLEM. Every provider the game talks to can reuse work on a prompt whose
// opening bytes it has seen before — OpenAI and Gemini automatically, Anthropic
// on request, and a local llama.cpp/Ollama/LM Studio server by keeping its KV
// cache. All of them need the same thing: a long, byte-identical PREFIX.
//
// The jump prompt had a prefix of 801 characters. Not because it is short — it
// is ~624 KB on a mature save — but because the first `${...}` sits 2.7% into
// the template and campaign state is woven through the prose from there on. One
// changed date near the top invalidates everything after it.
//
// The waste is large and repeated. A segmented jump sends the same prompt once
// per segment (four times on a one-year skip), and ~41% of it is the
// consolidated history, which only changes when the consolidator runs every ~5
// rounds. A measured retry that happened to resend an identical prompt reported
// `cachedTokens: 131,027 of 144,273` — 91% free. That is available on every
// segment and most turns, and it is thrown away by ordering alone.
//
// THE FIX. Group content by how often it changes, and emit it in that order:
//
//   RULES     the prompt's own prose and its directives. Never changes.
//   CAMPAIGN  chosen once and then fixed for the save: the player's polity, the
//             language, the scenario's rules and pre-game briefing, the region
//             count, the city coordinate catalogue.
//   ERA       changes every few rounds. In practice: the consolidated history.
//   NOW       this turn: the world snapshot, recent events, chats, units,
//             markers, orders, dates.
//
// Everything up to the NOW block is stable across the segments of a jump, and
// across turns until the consolidator next runs. That is the prefix.
//
// This module does NOT compress, summarise or drop anything. Every byte that was
// in the prompt is still in the prompt — it is only in a different order. That
// matters: the consolidated history is the sole surviving record of how a
// campaign diverged from real history, and shortening it is somebody else's
// call, not a side effect of a caching change.
//
// DELIBERATELY IMPORT-FREE, like jsonSalvage.js and providerErrors.js: which
// tier a variable belongs to is a judgement that wants direct tests, and
// gameplay.js reaches the whole browser runtime.

// Fixed for the life of a save once it has been created. A player who renames
// their country mid-campaign invalidates the prefix once and then it settles
// again, which is the correct trade.
export const CAMPAIGN_VARS = [
    "playerPolity",
    "language",
    "difficulty",
    "startDate",
    "simulationRules",
    "worldBeforeRoundOne",
    "numberOfRegions",
    "citiesSummary",
    "difficultyGuidanceJumpForward",
    "difficultyGuidanceChats",
];

// Changes every few rounds rather than every turn. Kept in its own tier so a
// turn that does NOT trigger consolidation still matches the previous turn's
// prefix all the way through it.
export const ERA_VARS = [
    "consolidatedHistory",
];

// Everything else is assumed to change every turn. Deliberately a fallback
// rather than a list: a variable added later and forgotten lands in NOW, which
// costs cache but is always CORRECT. The reverse — a volatile variable wrongly
// treated as stable — would not shorten the prefix, it would make it wrong, and
// the model would be handed last turn's world.
export const tierOf = (name) => {
    if (CAMPAIGN_VARS.includes(name)) return "campaign";
    if (ERA_VARS.includes(name)) return "era";
    return "now";
};

const label = (name) => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

// One labelled section per variable, so the model can still tell what it is
// reading once the values are no longer inline in the prose.
const renderBlock = (heading, names, variables) => {
    const parts = [];
    for (const name of names) {
        const value = String(variables?.[name] ?? "").trim();
        if (!value) continue;
        parts.push(`[${label(name)}]\n${value}`);
    }
    return parts.length ? `${heading}\n\n${parts.join("\n\n")}` : "";
};

/**
 * Assemble the trailing state blocks, most-stable first.
 *
 * `order` names the variables to emit and in what sequence; anything absent from
 * `variables`, or empty, is skipped so a task never carries an empty heading.
 */
export const buildStateBlocks = (variables, order) => {
    const names = Array.isArray(order) ? order : Object.keys(variables ?? {});
    const byTier = { campaign: [], era: [], now: [] };
    for (const name of names) byTier[tierOf(name)].push(name);

    return [
        renderBlock("=== THIS CAMPAIGN ===", byTier.campaign, variables),
        renderBlock("=== THE STORY SO FAR ===", byTier.era, variables),
        renderBlock("=== THE WORLD RIGHT NOW ===", byTier.now, variables),
    ].filter(Boolean).join("\n\n");
};

/**
 * How long a prefix this layout exposes — everything before the first NOW value.
 *
 * Used by the tests and by the diagnostics log, because "the prefix is 340 KB"
 * is the one number that says whether the reorder is working, and it is
 * otherwise invisible until a provider's cache-hit figure comes back.
 */
export const stablePrefixLength = (staticPrompt, variables, order) => {
    const names = Array.isArray(order) ? order : Object.keys(variables ?? {});
    const stable = names.filter((name) => tierOf(name) !== "now");
    const head = [
        String(staticPrompt ?? ""),
        renderBlock("=== THIS CAMPAIGN ===", stable.filter((n) => tierOf(n) === "campaign"), variables),
        renderBlock("=== THE STORY SO FAR ===", stable.filter((n) => tierOf(n) === "era"), variables),
    ].filter(Boolean).join("\n\n");
    return head.length;
};
