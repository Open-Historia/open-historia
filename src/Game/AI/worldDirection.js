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
// An event is the player's when the simulator says so (playerRelated) or when
// its own words name the player's polity: a model that under-declares cannot
// talk its way past the count. Whole words, case folded; a short name ("Ob") is
// matched the same way and simply matches rarely. Words in any script: kept to
// a-z and 0-9, a name written in Cyrillic or Arabic was never found.
const fold = (value) => ` ${String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim()} `;

export const eventConcernsPlayer = (event, playerNames = []) => {
    if (event?.playerRelated === true) return true;
    const text = fold(`${asText(event?.title)} ${asText(event?.description)}`);
    return asArray(playerNames).some((name) => {
        const needle = fold(name);
        // Three letters at least: " ob " is in half the paragraphs ever written.
        return needle.trim().length >= 3 && text.includes(needle);
    });
};

// Below this many events a share is not a meaningful thing to ask for.
export const WORLD_SHARE_MIN_EVENTS = 3;

// null when the floor is met (or does not apply); otherwise what to say.
export const worldShareShortfall = (events, floorPercent, { playerNames = [] } = {}) => {
    const list = asArray(events);
    const floor = Number(floorPercent);
    if (!(floor > 0) || list.length < WORLD_SHARE_MIN_EVENTS) return null;
    const needed = Math.ceil((list.length * Math.min(100, floor)) / 100);
    const world = list.filter((event) => !eventConcernsPlayer(event, playerNames)).length;
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
    return { beat: { date: match[1], title: (sentence ? sentence[1] : body).slice(0, 140).replace(/[.!?]$/, ""), text: body } };
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

const STOP_WORDS = new Set(["that", "this", "with", "from", "into", "over", "after", "before", "their", "there", "which", "while", "where", "when", "have", "been", "were", "will", "would", "than", "then", "them", "they", "against", "between", "under", "about", "through", "during", "first", "second", "third", "held", "holds", "hold", "makes", "made", "make", "takes", "take", "taken", "signed", "signs", "sign", "declares", "declared", "declare", "wins", "won", "win", "dies", "died", "die", "begins", "begin", "began", "ends", "end", "ended", "falls", "fall", "fell", "opens", "open", "opened", "government", "president", "minister", "state", "states", "national", "forces", "troops", "army", "city", "region", "country", "people", "power", "powers", "war", "treaty", "election", "elections", "vote", "votes"]);
const words = (text) => new Set(String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((word) => word.length >= 4 && !STOP_WORDS.has(word)));

// Did the answer write this beat? An event within a week of the beat's date
// that shares enough of its particular words — names, places, the things that
// make it THIS beat rather than any election or any battle. Words in any
// script (`words` above): split on a-z and 0-9 alone, a beat its author wrote
// in Russian or Greek had no words, was never found in the answer, and was
// written a second time by the engine beside the model's own telling of it.
export const SCRIPTED_MATCH_DAYS = 7;
export const beatIsWritten = (beat, events) => {
    const needles = [...words(`${beat?.title} ${beat?.text}`)];
    const beatDay = dateKey(beat?.date);
    if (!needles.length || beatDay === null) return false;
    const needed = Math.min(3, Math.max(1, Math.ceil(needles.length / 3)));
    return asArray(events).some((event) => {
        const eventDay = dateKey(event?.date);
        if (eventDay === null || Math.abs(eventDay - beatDay) > SCRIPTED_MATCH_DAYS) return false;
        const haystack = words(`${event?.title} ${event?.description}`);
        let shared = 0;
        for (const needle of needles) if (haystack.has(needle)) shared += 1;
        return shared >= needed;
    });
};

// The event the engine writes for a beat the answer left out: the author's own
// words, on the author's date, marked as the world's and as worth stopping for.
export const scriptedEventFor = (beat) => ({
    date: beat.date,
    title: beat.title,
    description: beat.text,
    importance: "major",
    kind: "world",
    tags: [],
    notable: true,
    playerRelated: false,
    impacts: {},
});

// The answer with every beat of the period in it: the ones it wrote as they
// are, the rest written by the engine. Pure; returns what was done.
export const ensureScriptedEvents = (events, beats) => {
    const list = [...asArray(events)];
    const written = [];
    const inserted = [];
    for (const beat of asArray(beats)) {
        if (beatIsWritten(beat, list)) written.push(beat);
        else { list.push(scriptedEventFor(beat)); inserted.push(beat); }
    }
    return { events: list, written, inserted };
};

// What the period is told about its beats: in the user message, beside the
// receipt, because they are this period's and not the whole game's.
export const buildScriptedEventsInstruction = (beats) => {
    const list = asArray(beats);
    if (!list.length) return "";
    return "[Scripted events this period — set by this scenario's author, checked by the engine]\n"
        + "These happen in this period. Write each as its own event, dated as given, in your own words and with the impacts it implies, and let the rest of the period feel its consequences. "
        + "They are history in this world: nothing you write may contradict or pre-empt them. One the answer leaves out is written by the engine in the author's words, without its impacts.\n"
        + list.map((beat) => `- ${beat.date} — ${beat.text}`).join("\n");
};

// --- The territory tempo ---
//
// How fast the map may move: regions changing hands per thirty days, counted
// over an answer's transfers and control changes in event order. Beyond the
// ceiling an entry is withheld — the front does not move that far this period
// — and the model is told, so the next period carries it on. A whole-country
// entry is the ceiling's worth by itself. 0 is no ceiling.
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
        if (!impacts) return event;
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
            + `An event that names ${player}, or that you mark playerRelated, counts as ${player}'s. The engine counts this on every answer and tells you when you fall short. `
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
