/*! Open Historia — world direction: a scenario author's settings, read and enforced by the engine © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario can already tell the simulator how to run its world in prose (the
// simulation rules, the prompt editor). Prose is a request. This is the other
// half: a few settings an author sets as NUMBERS, which the engine applies to
// what the simulator is asked for and counts on what it answers
// (server/gameFeatures.js "worldDirection"; the scenario's value, a game's
// override).
//
// None of it costs a request. Each setting shapes the one request a time skip
// already makes, and where the answer falls short it is KEPT — sending it back
// is a whole second request, on a key that may allow a few hundred a day
// (requestBudget.js) — and the simulator is told at the top of its next turn
// (runtime/applicationReceipt.js, the "short" note).
//
// Imports only the game-date rules (runtime/gameDates.js, itself import-free):
// gameplay.js hands in the resolved settings.

import { gameDateDayNumber } from "../../runtime/gameDates.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();
const scriptedTextMode = (value) => (asText(value).toLowerCase() === "exact" ? "exact" : "generated");
// Whether the player reads the game in a language other than English, the one a scenario's beats are most often
// written in: then a beat is told in that language, and an exact one is translated faithfully rather than copied.
const translated = (language) => {
    const name = asText(language).toLowerCase();
    return Boolean(name) && name !== "english" && name !== "en";
};

// --- Pace ---
//
// Scales the event count a period is asked for. The floor is one event, the
// upper end never falls below the lower, and a range that was a single number
// (a skip of a few hours is exactly one event) stays a single number: pace is
// about how crowded a month is, not about whether an afternoon happened.
export const scaleEventRange = (range, pacePercent = 100) => {
    const [min, max] = asArray(range).map((value) => Math.max(0, Math.round(Number(value) || 0)));
    // Number(null) is 0, and a pace of nothing is not a pace: both are the built-in one.
    const pace = pacePercent === null || pacePercent === undefined ? 100 : Number(pacePercent);
    if (!Number.isFinite(pace) || pace <= 0 || pace === 100 || !(min > 0) || min === max) return [min || 1, Math.max(min || 1, max || 1)];
    const scaledMin = Math.max(1, Math.round((min * pace) / 100));
    const scaledMax = Math.max(scaledMin, Math.round((max * pace) / 100));
    return [scaledMin, scaledMax];
};

// --- The world's share ---
//
// An event is the player's when the simulator marks it playerRelated, and only
// then: the directive below says what to mark. The player's names used to be
// looked for in its words as well, so that a model that under-declared could not
// talk its way past the count; but a name is found only where it is spelled as
// the game spells it, between spaces, so a period told in Chinese, or in a
// language that declines its names ("России"), counted differently from the
// same period told in English, and a namesake (Georgia the US state) counted
// as the player's.
export const eventConcernsPlayer = (event) => event?.playerRelated === true;

// Below this many events a share is not a meaningful thing to ask for.
export const WORLD_SHARE_MIN_EVENTS = 3;

// null when the floor is met (or does not apply); otherwise what to say.
export const worldShareShortfall = (events, floorPercent, { playerNames = [] } = {}) => {
    const list = asArray(events);
    const floor = Number(floorPercent);
    if (!(floor > 0) || list.length < WORLD_SHARE_MIN_EVENTS) return null;
    const needed = Math.ceil((list.length * Math.min(100, floor)) / 100);
    const world = list.filter((event) => !eventConcernsPlayer(event)).length;
    if (world >= needed) return null;
    const player = asText(asArray(playerNames)[0]) || "the player's polity";
    return {
        total: list.length,
        world,
        needed,
        text: `${world} of your ${list.length} events ${world === 1 ? "was" : "were"} about the world beyond ${player}; this scenario asks for at least ${needed} (${Math.round(floor)}%). `
            + `Other powers act on each other whether or not ${player} is watching: give them events of their own, in theatres ${player} is not in.`,
    };
};

// --- Scripted events ---
//
// An author's history beats: one per line, dated, in the author's own words.
//
//   2014-05-25  Ukraine votes: Petro Poroshenko wins the presidency outright.
//   1918-11-11 — The armistice is signed at Compiègne; the guns fall silent at 11.
//   # a line without a date, or starting with #, is ignored
//
// The date is the first thing on the line (a year before AD 1 written with a
// leading minus, as everywhere in the game); what follows, after any dash or
// colon, is the beat. A beat is HISTORY in its world: the period that covers
// its date is asked to write it, and when the answer does not, the engine
// writes it — an author's beat does not depend on the model's mood, and asking
// again would be a whole second request.
const DATE_AT_START = /^\s*(-?\d{1,4}-\d{2}-\d{2})\s*(?:[—–\-:|]+\s*)?(.*)$/;

// A date as one number that sorts, negative years included, and a count of
// days for "within a week of": its day number (runtime/gameDates.js), so
// 15 April 218 BC falls before 18 December 218 BC and both before 0001-01-01.
// Null when it is not a game date.
export const dateKey = (iso) => gameDateDayNumber(asText(iso));

// One line: null for a blank line or a # comment, { beat } for a beat, and
// { problem } ("no-date" | "no-text") for a line the engine will not use.
const readScriptedLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return null;
    const match = DATE_AT_START.exec(line);
    if (!match || dateKey(match[1]) === null) return { problem: "no-date" };
    const body = asText(match[2]);
    if (!body) return { problem: "no-text" };
    // The title is the first sentence, or the whole beat when it is one.
    const sentence = /^(.{12,140}?[.!?])\s/.exec(`${body} `);
    return { beat: { date: match[1], title: (sentence ? sentence[1] : body).slice(0, 140).replace(/[.!?]$/, ""), text: body, textMode: "generated" } };
};

export const parseScriptedEvents = (text) => {
    const beats = [];
    for (const rawLine of asText(text).split(/\r?\n/)) {
        const read = readScriptedLine(rawLine);
        if (read?.beat) beats.push(read.beat);
    }
    return beats.sort((a, b) => dateKey(a.date) - dateKey(b.date));
};

// What the editor shows under the setting: how many beats the engine will
// use, and every line it will not, as the author typed it. "passed" is a beat
// no skip will reach: dated on or before `currentDate` (the game's date, or
// the scenario's start), except that the day itself still counts while
// `includeOrigin` (a game's first skip covers it). The same rule
// scriptedBeatsInSpan applies when the skip runs.
export const reviewScriptedEvents = (text, { currentDate = "", includeOrigin = false } = {}) => {
    let count = 0;
    const ignored = [];
    const dated = dateKey(currentDate) !== null;
    for (const rawLine of asText(text).split(/\r?\n/)) {
        const read = readScriptedLine(rawLine);
        if (!read) continue;
        if (read.problem) {
            ignored.push({ line: rawLine.trim(), problem: read.problem });
            continue;
        }
        const reachable = !dated
            || scriptedBeatsInSpan([read.beat], { originDate: currentDate, targetDate: "9999-12-31", includeOrigin }).length > 0;
        if (reachable) count += 1;
        else ignored.push({ line: rawLine.trim(), problem: "passed" });
    }
    return { count, ignored };
};

// Prehistory/bootstrap is not a completed time skip. The initial game already
// has a pregame simulationHistory entry in some scenarios, so its length cannot
// decide whether the start day's authored beats have been processed.
// `scriptedEventState` still prevents replaying any previously resolved beat.
export const firstSkipIncludesScriptedOrigin = ({ game = {}, originDate = "", segmentIndex = 0 } = {}) => {
    const origin = dateKey(originDate);
    const authoredStart = asText(game?.startDate);
    return segmentIndex === 0
        && origin !== null
        && Number(game?.round) === 1
        && (!authoredStart || origin === dateKey(authoredStart));
};

// The beats a period covers: after its origin (the day itself belongs to the
// period before) up to and including its target — except on a game's very
// first skip, whose origin day nobody covered.
export const scriptedBeatsInSpan = (beats, { originDate, targetDate, includeOrigin = false } = {}) => {
    const origin = dateKey(originDate);
    const target = dateKey(targetDate);
    if (origin === null || target === null) return [];
    return asArray(beats).filter((beat) => {
        const key = dateKey(beat?.date);
        return key !== null && (key > origin || (includeOrigin && key === origin)) && key <= target;
    });
};

// Did the answer write this beat? Only an event that says so: the period is
// shown each beat with its id (buildScriptedEventsInstruction), and the event
// that tells it carries that id in `scriptedBeat` (the skip's event schema,
// gameplaySchemas.js). The id is the scenario's own (server/gameFeatures.js
// normalizeScriptedEvents), compared exactly, case and spacing aside, and
// without the square brackets the prompt shows it in. A beat with no id can
// only be written by the engine.
//
// An event near the beat's date that shared enough of its words used to count
// as its telling: a faithful telling in other words, or in the player's own
// language, was taken for missing and the engine wrote the author's copy beside
// it; a different event that shared a name or two was taken for the beat, had
// the author's impacts put on it, and in exact wording had its text replaced.
const beatKey = (value) => asText(value).replace(/^\[(.*)\]$/, "$1").toLowerCase().replace(/\s+/g, "");
export const beatIsWritten = (beat, events) => {
    const id = beatKey(beat?.id);
    return Boolean(id) && asArray(events).some((event) => beatKey(event?.scriptedBeat) === id);
};

// The event the engine writes for a beat the answer left out: the author's own
// words, on the author's date, marked as the world's and as worth stopping for,
// and naming the beat it tells as the model's own telling would.
// An instruction the AI was to write is the author's direction, so its square-bracketed asides to the simulator
// ("[In terms of map changes: …]") stay out of the engine's copy; exact wording is kept whole.
const withoutAsides = (value) => asText(value).replace(/\s*\[[^\]]*\]/g, "").replace(/[ \t]{2,}/g, " ").trim() || asText(value);
export const scriptedEventFor = (beat) => {
    const parentText = asText(beat?.parentText);
    const exact = scriptedTextMode(beat?.textMode) === "exact";
    const description = exact
        ? beat.text
        : parentText
            ? `${withoutAsides(parentText)}

${withoutAsides(beat?.text)}`
            : withoutAsides(beat?.text);
    return {
        date: beat.date,
        title: beat.title,
        description,
        importance: "major",
        kind: "world",
        tags: [],
        notable: true,
        playerRelated: false,
        impacts: {},
        ...(asText(beat?.id) ? { scriptedBeat: asText(beat.id) } : {}),
    };
};

// The answer with every beat of the period in it: the ones it wrote as they
// are, the rest written by the engine. Pure; returns what was done.
export const ensureScriptedEvents = (events, beats, { language = "" } = {}) => {
    const list = [...asArray(events)];
    const generatedCount = list.length;
    const consumed = new Set();
    const written = [];
    const inserted = [];
    for (const beat of asArray(beats)) {
        // Only pre-existing model events can satisfy authored beats, one-to-one.
        // Never let a single generated card or a previous fallback insertion
        // silently discharge a second same-day scripted event.
        let matchIndex = -1;
        for (let index = 0; index < generatedCount; index += 1) {
            if (!consumed.has(index) && beatIsWritten(beat, [list[index]])) {
                matchIndex = index;
                break;
            }
        }
        if (matchIndex !== -1) {
            consumed.add(matchIndex);
            written.push(beat);
            if (scriptedTextMode(beat?.textMode) === "exact" && translated(language)) {
                // In another language the author's wording is the model's faithful translation of it: kept as written,
                // on the author's date, without an added quotation.
                const { quote: _quote, ...generated } = list[matchIndex] || {};
                list[matchIndex] = { ...generated, date: beat.date };
            } else if (scriptedTextMode(beat?.textMode) === "exact") {
                // Exact wording freezes presentation, not consequences. Keep every
                // structured effect the simulator supplied, but restore the author
                // date/headline/body and remove any AI-added quotation.
                const { quote: _quote, ...generated } = list[matchIndex] || {};
                list[matchIndex] = {
                    ...generated,
                    date: beat.date,
                    title: beat.title,
                    description: beat.text,
                };
            }
        } else {
            list.push(scriptedEventFor(beat));
            inserted.push(beat);
        }
    }
    return { events: list, written, inserted };
};

// What the period is told about its beats: in the user message, beside the
// receipt, because they are this period's and not the whole game's. Each with
// its id, which the event that tells it carries in scriptedBeat (beatIsWritten).
export const buildScriptedEventsInstruction = (beats, { language = "" } = {}) => {
    const list = asArray(beats);
    if (!list.length) return "";
    const inLanguage = translated(language);
    const hasExact = list.some((beat) => scriptedTextMode(beat?.textMode) === "exact");
    const rows = list.map((beat) => {
        const exact = scriptedTextMode(beat?.textMode) === "exact";
        const parentText = asText(beat?.parentText);
        const id = asText(beat?.id) ? `[${asText(beat.id)}] ` : "";
        if (!parentText) return `- ${id}${beat.date} — ${exact ? "[EXACT WORDING] " : ""}${beat.text}`;
        return [
            `- ${id}${beat.date} — Parent event: ${parentText}`,
            `  Selected outcome: ${exact ? "[EXACT WORDING] " : ""}${beat.text}`,
            "  The selected outcome refines this parent event; it does not replace its people, places, actors or subject.",
        ].join("\n");
    });
    return "[Scripted events this period — set by this scenario's author, checked by the engine]\n"
        + "These happen in this period. Write each as its own event, dated as given, with the impacts it implies, and let the rest of the period feel its consequences. "
        + "Set that event's scriptedBeat to the id in square brackets at the start of the entry's line: that id, and nothing in the event's wording, is how the engine knows the entry was written. "
        + "Ordinary entries are instructions: write their final event in your own words. For a branched event, the selected outcome refines the parent event rather than replacing its context. "
        + (hasExact
            ? (inLanguage
                ? `An entry marked [EXACT WORDING] is different: its title is the text up to its first full stop; write that title and the supplied text into the event as a faithful translation into ${language}, adding nothing, and do not add a quotation or extra prose to that event; still supply every canonical impact it implies. When an exact selected outcome has a parent event, use the parent only as context for those consequences, not as extra visible prose. `
                : "An entry marked [EXACT WORDING] is different: copy its supplied text verbatim into the event description and do not add a quotation or extra prose to that event; still supply every canonical impact it implies. When an exact selected outcome has a parent event, use the parent only as context for those consequences, not as extra visible prose. The engine enforces the author's visible wording while preserving those impacts. ")
            : "")
        + (inLanguage
            ? `Write each of them in ${language}, on the date given, keeping the names of its people and places as the entry gives them. `
            : "")
        + "They are history in this world: nothing you write may contradict or pre-empt them. One that no event of the answer names in scriptedBeat is written by the engine in the author's words, with only the impacts its author attached.\n"
        + rows.join("\n");
};

// --- The territory tempo ---
//
// How fast the map may move: regions changing hands per thirty days, counted
// over an answer's transfers and control changes in event order. Beyond the
// ceiling an entry is withheld — the front does not move that far this period
// — and the model is told, so the next period carries it on. A whole-country
// entry is the ceiling's worth by itself. 0 is no ceiling.
//
// An event that tells one of the author's scripted events is the author's own
// pace: its territory changes (the author's impacts and the model's for it)
// are never withheld and never counted. scriptedEventImpacts.js marks such an
// event with this key; a symbol, so it never reaches a save.
export const SCRIPTED_EVENT = Symbol.for("openHistoria.scriptedEvent");

export const territoryTempoAllowance = (ceilingPerMonth, spanDays) => {
    const ceiling = Number(ceilingPerMonth);
    if (!(ceiling > 0)) return Infinity;
    return Math.max(1, Math.ceil((ceiling * Math.max(1, Number(spanDays) || 1)) / 30));
};

export const applyTerritoryTempo = (events, { ceilingPerMonth, spanDays } = {}) => {
    const allowance = territoryTempoAllowance(ceilingPerMonth, spanDays);
    const list = asArray(events);
    if (!Number.isFinite(allowance)) return { events: list, withheld: 0, allowance };
    let used = 0;
    let withheld = 0;
    const next = list.map((event) => {
        const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : null;
        if (!impacts || event[SCRIPTED_EVENT]) return event;
        // A border moves on a transfer and on a control op that says "control";
        // a contest opened or cleared moves nothing and is never withheld.
        const keep = (entry) => {
            const cost = entry?.wholeCountry ? allowance : 1;
            if (used + cost > allowance) { withheld += 1; return false; }
            used += cost;
            return true;
        };
        const transfers = asArray(impacts.regionTransfers).filter((entry) => keep(entry));
        const control = asArray(impacts.regionControlOps).filter((entry) => (String(entry?.op ?? "").toLowerCase() === "control" ? keep(entry) : true));
        if (transfers.length === asArray(impacts.regionTransfers).length && control.length === asArray(impacts.regionControlOps).length) return event;
        return { ...event, impacts: { ...impacts, regionTransfers: transfers, regionControlOps: control } };
    });
    return { events: next, withheld, allowance };
};

// --- What the simulator is told ---
//
// Written LAST in the jump's instructions, where a long prompt is followed best,
// and marked as the author's. The priority rules say in so many words that they
// outrank the defaults and the field descriptions of the output function —
// without that, a rule like "no nuclear weapons before 1945" loses to a field
// description that lists nuclear programmes as a thing a polity can start.
export const PRIORITY_RULES_HEADING = "[PRIORITY RULES — set by this scenario's author]";

// The author's priority rules alone, without the share and the tempo (which
// only a time skip is counted against). Every other task that writes the world
// or speaks for a polity carries them too: a rule broken by a Projects entry, an
// interactive event or a leader's reply is a world every later skip inherits.
export const buildPriorityRulesBlock = (direction) => {
    const rules = asText(direction?.priorityRules);
    if (!rules) return "";
    return `${PRIORITY_RULES_HEADING}\n`
        + "These rules outrank everything else you have been told: the default guidance above, the simulation rules, and anything a field description of the output function suggests is possible. "
        + "Where a rule and a default disagree, the rule wins, without exception and without comment in the events.\n"
        + rules;
};

export const buildWorldDirectionDirective = (direction, { playerPolity = "", spanDays = 30 } = {}) => {
    if (!direction) return "";
    const player = asText(playerPolity) || "the player's polity";
    const parts = [];
    const share = Number(direction.worldShare);
    if (share > 0) {
        parts.push(
            "[The World's Share — counted by the engine]\n"
            + `At least ${Math.round(share)}% of this period's events must be developments that do not involve ${player} at all: other powers acting on each other, in theatres ${player} is not in. `
            + `An event counts as ${player}'s when you mark it playerRelated: mark every event ${player} takes part in, is the subject of, or that happens inside its territory. The engine counts these marks on every answer and tells you when you fall short. `
            + `This is a floor on how much of the world you show, NOT a ceiling on what the world does to ${player}: meet it by writing more elsewhere, never by leaving a rival's move against the player unwritten.`,
        );
    }
    const tempo = Number(direction.territoryTempo);
    if (tempo > 0) {
        const allowance = territoryTempoAllowance(tempo, spanDays);
        parts.push(
            "[The Map's Tempo — counted by the engine]\n"
            + `In this scenario the map moves no faster than ${Math.round(tempo)} region${Math.round(tempo) === 1 ? "" : "s"} per thirty days: ${allowance} this period, across every regionTransfers entry and every regionControlOps control, counted in event order. `
            + "Beyond that the engine withholds the entry and tells you. Write fronts that grind — a river line held, a siege that drags — rather than sweeps.",
        );
    }
    const rules = buildPriorityRulesBlock(direction);
    if (rules) parts.push(rules);
    return parts.join("\n\n");
};
