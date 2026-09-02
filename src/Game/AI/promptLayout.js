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

// Some variables are two different things concatenated, and tiering them as one
// wastes the stable half.
//
// recentEventsLong is the worst case: buildCampaignHistoryText joins the
// consolidated "story so far" - 258KB on a mature save, rewritten only when the
// consolidator runs every ~5 rounds - onto the last 24 events, which change every
// turn. Glued together it can only be volatile, so a quarter of the whole prompt
// falls out of the prefix because of how it is packaged.
//
// Both halves already exist as their own variables, so v2 asks for them
// separately. Nothing new is computed and nothing is dropped - the same text
// goes, in two blocks instead of one.
export const DECOMPOSES_INTO = {
    recentEventsLong: ["consolidatedHistory", "recentEvents"],
};

// Expand any variable that is really two, preserving order and dropping repeats.
export const expandVariableOrder = (order) => {
    const out = [];
    for (const name of Array.isArray(order) ? order : []) {
        for (const part of DECOMPOSES_INTO[name] ?? [name]) {
            if (!out.includes(part)) out.push(part);
        }
    }
    return out;
};

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

// ---------------------------------------------------------------------------
// Turning an existing template into a static one
// ---------------------------------------------------------------------------
//
// v2 needs task text with no values in it, so the whole thing can sit inside the
// reusable prefix. The obvious route — hand-write a second copy of every
// template — is the worst one available: ~30 KB of carefully tuned rules per
// task, retyped, with every chance to change what the model is told, and then a
// migration to get it to existing saves.
//
// This does it mechanically instead. Each `${...}` becomes a short pointer to the
// labelled block the value now lives in, and every other character of the rules
// survives byte-for-byte. It runs on whatever pack a save already has, so a
// frozen campaign gets the same treatment as a fresh one and there is nothing to
// migrate.
//
// Simply blanking the placeholders is NOT good enough, which is worth stating
// because it is the tempting shortcut: renderTemplate with no variables turns
// "the world as of the Origin Date, ${ORIGIN_ROUND_DATE}:" into "the world as of
// the Origin Date, :" — prose the model has to work around, at 29 sites.

const POINTER = (labelText) => `(see "${labelText}" at the end of this prompt)`;

// `${FOO}` is a helper placeholder that maps to `${someVar}`; `${someVar}` is a
// variable named directly. Both appear in the shipped templates.
// Both spellings the shipped templates use: `${FOO}` (a helper placeholder) and
// `${someVar}` (a variable named directly).
const PLACEHOLDER_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const resolveVariableName = (name, helpers) => {
    const mapped = String(helpers?.[name] ?? "").trim();
    const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(mapped);
    return match ? match[1] : name;
};

/**
 * Rewrite a template so nothing VOLATILE is left in it, and report what moved.
 *
 * Campaign-tier values stay inline. They are fixed for the life of the save, so
 * they cost the prefix nothing, and leaving them where the prose put them keeps
 * sentences readable - "Write in English" beats "Write in (see language at the
 * end)", which matters most for the short ones a pointer would be longer than.
 *
 * Everything else becomes a pointer to its labelled block. Those are the values
 * that change between calls, and one left inline near the top would end the
 * reusable prefix right there.
 *
 * Returns `{ text, order }` - the stable head, and the variables that moved, in
 * the order the prose first mentions them, so the trailing blocks follow the
 * same sequence the rules introduce them in.
 */
export const staticiseTemplate = (templateText, helpers, variables) => {
    const moved = [];
    const text = String(templateText ?? "").replace(PLACEHOLDER_PATTERN, (match, name) => {
        const variable = resolveVariableName(name, helpers);
        if (tierOf(variable) === "campaign") {
            const value = String(variables?.[variable] ?? "").trim();
            // Fall through to a pointer when the value is missing, rather than
            // leaving a hole in the middle of a sentence.
            if (value) return value;
        }
        if (!moved.includes(variable)) moved.push(variable);
        return POINTER(label(variable));
    });
    return { text, order: expandVariableOrder(moved) };
};
