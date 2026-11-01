/*! Open Historia — call-time directive de-duplication © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
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

// ---------------------------------------------------------------------------
// A large block the prompt carries more than once
// ---------------------------------------------------------------------------
//
// The scenario's pre-round-one briefing reaches the prompt by two routes: the
// task text renders ${WORLD_BEFORE_ROUND_ONE_TEXT} directly, AND buildWorldSummary
// embeds the same string in the world snapshot. Eight of the sixteen prompts
// render both, so both copies go every call. On a real campaign that is 107,870
// characters sent twice - about 35% of a jump prompt spent saying the same thing
// a second time.
//
// It cannot be fixed by editing the templates: existing campaigns carry frozen
// copies, and two tasks (countryStatSheet, actions) reach the briefing ONLY
// through the world summary, so removing it there would take it away from them
// entirely. Collapsing the repeat after the prompt is assembled fixes every save
// at once and cannot take anything away from a prompt that only had it once.
//
// The FIRST occurrence is the one kept, so the briefing still appears in the
// position the prompt's own prose introduces it.

// Long enough that a repeat is certainly the same block rather than a coincidence,
// and short enough to catch a modest briefing. A placeholder like "No pre-game
// world briefing was provided." must never be de-duplicated: it is not bulk, and
// replacing it with a pointer would read as though something had been omitted.
export const DEDUPE_MIN_BLOCK_CHARS = 400;

/**
 * Keep the first copy of `block`, replace any later copy with `pointer`.
 *
 * Returns the prompt unchanged when the block is absent, short, or appears only
 * once — so this is safe to call unconditionally.
 */
export const collapseRepeatedBlock = (prompt, block, pointer) => {
    const text = String(prompt ?? "");
    const needle = String(block ?? "").trim();
    if (!text || needle.length < DEDUPE_MIN_BLOCK_CHARS) return text;

    const first = text.indexOf(needle);
    if (first === -1) return text;
    const second = text.indexOf(needle, first + needle.length);
    if (second === -1) return text;

    // Everything up to and including the first copy is untouched; every later
    // copy becomes the pointer.
    const head = text.slice(0, first + needle.length);
    const tail = text.slice(first + needle.length).split(needle).join(String(pointer ?? ""));
    return head + tail;
};

// The scenario's simulation rules take the same two routes: the task text
// renders ${HISTORICAL_PRESET_SIMULATION_RULES}, and buildWorldSummary embeds
// them on its "Simulation rules:" line. Eleven prompts render both, the advisor
// and the diplomatic chat among them. Two tasks (actions, idleDiplomacy) reach
// the rules ONLY through the world summary, so the same reasoning as the
// briefing applies: collapse after assembly, never strip them from the summary.

export const BRIEFING_POINTER = "(The pre-round-one briefing is reproduced in full earlier in this prompt.)";
export const SIMULATION_RULES_POINTER = "(The scenario's simulation rules are reproduced in full earlier in this prompt.)";

/**
 * Collapse every repeat of the briefing and the simulation rules in an
 * assembled prompt. `variables` is the prompt's template variables; a missing
 * or short value leaves the prompt as it was.
 */
export const collapseRepeatedWorldContext = (prompt, variables) => collapseRepeatedBlock(
    collapseRepeatedBlock(prompt, variables?.worldBeforeRoundOne, BRIEFING_POINTER),
    variables?.simulationRules,
    SIMULATION_RULES_POINTER,
);

// ---------------------------------------------------------------------------
// What a fenced job inside the prompt repeats from before it
// ---------------------------------------------------------------------------
//
// A time skip that carries the history fold (historyConsolidation.js
// buildSkipHistoryJob) pastes the consolidator's whole prompt in at its end:
// the events to fold, word for word, the current history document, the orders.
// The skip's own prompt shows most of that already, earlier: the events not yet
// folded are its event history, and the document opens it. On a seven-week
// Discord test game (2026-10-27) the fold job was 61,116 characters, of which
// 23,623 were lines the same prompt had already given.
//
// Inside the job's fences, a line long enough that a repeat is certainly the
// same text (an event's paragraph, a line of the document) and present word for
// word earlier in the prompt becomes a pointer to it; a run of them, one
// pointer. Short lines - an event's date and title - stay, so the job still
// names everything it covers. Nothing outside the fences changes, and nothing
// the prompt does not already say earlier is touched.
export const JOB_REPEAT_MIN_LINE_CHARS = 200;
export const EARLIER_TEXT_POINTER = "(Given word for word earlier in this prompt; read it there.)";

export const collapseRepeatsInsideJob = (prompt, { begin, end, minChars = JOB_REPEAT_MIN_LINE_CHARS, pointer = EARLIER_TEXT_POINTER } = {}) => {
    const text = String(prompt ?? "");
    const start = begin ? text.indexOf(begin) : -1;
    if (start === -1) return text;
    const stop = end ? text.indexOf(end, start + begin.length) : -1;
    if (stop === -1) return text;
    const earlier = text.slice(0, start);
    const out = [];
    let blanks = [];
    let collapsing = false;
    for (const line of text.slice(start, stop).split("\n")) {
        const content = line.trim();
        if (!content) {
            blanks.push(line);
            continue;
        }
        if (content.length >= minChars && earlier.includes(content)) {
            // Blank lines between two repeated paragraphs go with them.
            if (!collapsing) out.push(...blanks, `${line.slice(0, line.length - line.trimStart().length)}${pointer}`);
            blanks = [];
            collapsing = true;
            continue;
        }
        out.push(...blanks, line);
        blanks = [];
        collapsing = false;
    }
    out.push(...blanks);
    return text.slice(0, start) + out.join("\n") + text.slice(stop);
};
