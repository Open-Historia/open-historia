/*! Open Historia — world direction: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/worldDirection.test.js
//
// Runs without node_modules: worldDirection.js imports only runtime/gameDates.js.
//
// These are an author's settings, so the promise is to the author: the number
// they set is the number the engine uses. And to the player: none of it may
// cost a request — a skip that falls short is kept and the model is told, never
// asked again.

import test from "node:test";
import assert from "node:assert/strict";

import {
    PRIORITY_RULES_HEADING,
    applyTerritoryTempo,
    beatIsWritten,
    buildPriorityRulesBlock,
    buildScriptedEventsInstruction,
    dateKey,
    ensureScriptedEvents,
    parseScriptedEvents,
    reviewScriptedEvents,
    scriptedBeatsInSpan,
    territoryTempoAllowance,
    WORLD_SHARE_MIN_EVENTS,
    buildWorldDirectionDirective,
    eventConcernsPlayer,
    scaleEventRange,
    worldShareShortfall,
} from "./worldDirection.js";

test("pace scales what a period is asked for, and 100 changes nothing", () => {
    assert.deepEqual(scaleEventRange([5, 7], 100), [5, 7]);
    assert.deepEqual(scaleEventRange([5, 7], 50), [3, 4]);
    assert.deepEqual(scaleEventRange([5, 7], 200), [10, 14]);
    assert.deepEqual(scaleEventRange([10, 13], 40), [4, 5]);
    assert.deepEqual(scaleEventRange([29, 37], 250), [73, 93]);
});

test("a period never asks for nothing, and its upper end never falls below its lower", () => {
    assert.deepEqual(scaleEventRange([1, 2], 40), [1, 1]);
    assert.deepEqual(scaleEventRange([2, 2], 40), [2, 2], "a fixed count is not a pace");
    // An afternoon is one event however crowded the author likes their months.
    assert.deepEqual(scaleEventRange([1, 1], 250), [1, 1]);
});

test("a pace that is not a number is the built-in pace", () => {
    for (const pace of [undefined, null, "fast", Number.NaN]) assert.deepEqual(scaleEventRange([5, 7], pace), [5, 7]);
    assert.deepEqual(scaleEventRange(null, 150), [1, 1]);
});

const PLAYER = ["Russian Federation", "Russia"];
const event = (title, description = "", extra = {}) => ({ title, description, ...extra });

test("an event is the player's when the simulator says so, or when its own words name the player", () => {
    assert.equal(eventConcernsPlayer(event("Moscow raises tariffs", "", { playerRelated: true }), PLAYER), true);
    assert.equal(eventConcernsPlayer(event("Poland protests to the Russian Federation"), PLAYER), true);
    assert.equal(eventConcernsPlayer(event("Warsaw recalls its envoy", "The note is addressed to RUSSIA."), PLAYER), true);
    assert.equal(eventConcernsPlayer(event("Brazil devalues the real", "Coffee exporters cheer."), PLAYER), false);
});

test("the player's name is matched as whole words, never inside another", () => {
    assert.equal(eventConcernsPlayer(event("Prussian reforms begin", "Belorussian exiles take note."), ["Russia"]), false);
    assert.equal(eventConcernsPlayer(event("Romania mobilises"), ["Oman"]), false);
    assert.equal(eventConcernsPlayer(event("Talks open in Oman"), ["Oman"]), true);
    // A name too short to mean anything is not searched for at all.
    assert.equal(eventConcernsPlayer(event("Ob river floods"), ["Ob"]), false);
});

test("the floor is met when enough of the period belongs to the rest of the world", () => {
    const events = [
        event("Russian forces enter Kharkiv", "", { playerRelated: true }),
        event("Brazil devalues the real"),
        event("Japan launches a carrier"),
    ];
    assert.equal(worldShareShortfall(events, 35, { playerNames: PLAYER }), null);
    assert.equal(worldShareShortfall(events, 66, { playerNames: PLAYER }), null, "2 of 3 is 66%");
});

test("a shortfall says the count, the floor, and what to do about it", () => {
    const events = [
        event("Russian forces enter Kharkiv", "", { playerRelated: true }),
        event("NATO condemns Russia"),
        event("The Russian Federation recalls its envoy"),
        event("Brazil devalues the real"),
        event("Sanctions on Russia widen"),
    ];
    const shortfall = worldShareShortfall(events, 40, { playerNames: PLAYER });
    assert.deepEqual([shortfall.world, shortfall.total, shortfall.needed], [1, 5, 2]);
    assert.match(shortfall.text, /^1 of your 5 events was about the world beyond Russian Federation; this scenario asks for at least 2 \(40%\)\./);
    assert.match(shortfall.text, /give them events of their own/);
});

test("the floor does not apply to a handful of events, or when it is switched off", () => {
    const playerOnly = Array.from({ length: WORLD_SHARE_MIN_EVENTS - 1 }, () => event("x", "", { playerRelated: true }));
    assert.equal(worldShareShortfall(playerOnly, 50, { playerNames: PLAYER }), null);
    const many = Array.from({ length: 6 }, () => event("x", "", { playerRelated: true }));
    assert.equal(worldShareShortfall(many, 0, { playerNames: PLAYER }), null);
    assert.equal(worldShareShortfall(many, undefined, { playerNames: PLAYER }), null);
    assert.equal(worldShareShortfall(null, 50), null);
    assert.equal(worldShareShortfall(many, 50, { playerNames: PLAYER }).needed, 3);
});

test("the simulator is told the floor as a number, that the engine counts it, and how an event counts", () => {
    const directive = buildWorldDirectionDirective({ eventPace: 100, worldShare: 35, priorityRules: "" }, { playerPolity: "Russian Federation" });
    assert.match(directive, /^\[The World's Share — counted by the engine\]/);
    assert.match(directive, /At least 35% of this period's events/);
    assert.match(directive, /names Russian Federation, or that you mark playerRelated/);
    assert.doesNotMatch(directive, /PRIORITY RULES/);
});

test("priority rules come last, word for word, and say what they outrank", () => {
    const rules = "No power may field nuclear weapons before 1945.\nThe Ottoman Empire cannot collapse before 1918.";
    const directive = buildWorldDirectionDirective({ worldShare: 35, priorityRules: rules }, { playerPolity: "France" });
    assert.ok(directive.endsWith(rules));
    assert.ok(directive.indexOf("[The World's Share") < directive.indexOf(PRIORITY_RULES_HEADING));
    assert.match(directive, /outrank everything else you have been told/);
    assert.match(directive, /anything a field description of the output function suggests/);
});

test("nothing set, or world direction off, adds nothing to the prompt", () => {
    assert.equal(buildWorldDirectionDirective(null), "");
    assert.equal(buildWorldDirectionDirective({ eventPace: 150, worldShare: 0, priorityRules: "  " }), "");
    // Pace alone is not said: it is already in the numbers the skip asks for.
    assert.equal(buildWorldDirectionDirective({ eventPace: 40, worldShare: 0, priorityRules: "" }), "");
});

// --- scripted events ---

test("a beat is a dated line in the author's words; the rest of the text is ignored", () => {
    const beats = parseScriptedEvents([
        "# the war",
        "1914-06-28  Archduke Franz Ferdinand is assassinated in Sarajevo. Vienna blames Belgrade.",
        "1914-07-28 — Austria-Hungary declares war on Serbia",
        "a line with no date",
        "1914-08-01: Germany declares war on Russia",
        "-0218-08-02 Hannibal destroys the Roman army at Cannae.",
        "",
    ].join("\n"));
    assert.deepEqual(beats.map((beat) => beat.date), ["-0218-08-02", "1914-06-28", "1914-07-28", "1914-08-01"]);
    assert.equal(beats[1].title, "Archduke Franz Ferdinand is assassinated in Sarajevo");
    assert.equal(beats[1].text, "Archduke Franz Ferdinand is assassinated in Sarajevo. Vienna blames Belgrade.");
    assert.equal(beats[2].title, "Austria-Hungary declares war on Serbia");
    assert.deepEqual(parseScriptedEvents(""), []);
    assert.deepEqual(parseScriptedEvents(null), []);
});

test("dates sort as numbers, years before AD 1 included", () => {
    assert.ok(dateKey("-0218-08-02") < dateKey("0001-01-01"));
    assert.ok(dateKey("1914-07-28") < dateKey("1914-08-01"));
    assert.ok(dateKey("-0218-04-15") < dateKey("-0218-12-18"), "April comes before December inside a BC year");
    assert.ok(dateKey("-0218-12-31") < dateKey("-0217-01-01"), "218 BC comes before 217 BC");
    assert.equal(dateKey("not a date"), null);
});

test("BC beats list in calendar order and land in the skip that covers them", () => {
    const beats = parseScriptedEvents([
        "-0218-12-18 Hannibal defeats the Romans at the Trebia.",
        "-0218-04-15 Hannibal crosses the Rhone with his elephants.",
        "-0217-06-21 Hannibal ambushes the Romans at Lake Trasimene.",
    ].join("\n"));
    assert.deepEqual(beats.map((beat) => beat.date), ["-0218-04-15", "-0218-12-18", "-0217-06-21"]);
    const spring = scriptedBeatsInSpan(beats, { originDate: "-0218-03-01", targetDate: "-0218-06-30" });
    assert.deepEqual(spring.map((beat) => beat.date), ["-0218-04-15"]);
    const winter = scriptedBeatsInSpan(beats, { originDate: "-0218-06-30", targetDate: "-0218-12-31" });
    assert.deepEqual(winter.map((beat) => beat.date), ["-0218-12-18"]);
});

test("a period covers the beats after its origin up to its target; the first skip covers its origin day too", () => {
    const beats = parseScriptedEvents("2014-04-21 A\n2014-05-01 B\n2014-05-21 C\n2014-05-22 D");
    const span = { originDate: "2014-04-21", targetDate: "2014-05-21" };
    assert.deepEqual(scriptedBeatsInSpan(beats, span).map((beat) => beat.text), ["B", "C"]);
    assert.deepEqual(scriptedBeatsInSpan(beats, { ...span, includeOrigin: true }).map((beat) => beat.text), ["A", "B", "C"]);
    assert.deepEqual(scriptedBeatsInSpan(beats, { originDate: "bad", targetDate: "2014-05-21" }), []);
});

test("the editor's check counts the beats and names every line the engine will not use", () => {
    const text = [
        "# a comment is not a problem",
        "1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.",
        "28/07/1914 Austria-Hungary declares war on Serbia",
        "1914-08-01",
        "  1914-8-3 Germany declares war on France",
        "",
        "1914-08-04 Britain declares war on Germany.",
    ].join("\n");
    const review = reviewScriptedEvents(text, { currentDate: "1914-01-01" });
    assert.equal(review.count, 2);
    assert.deepEqual(review.ignored, [
        { line: "28/07/1914 Austria-Hungary declares war on Serbia", problem: "no-date" },
        { line: "1914-08-01", problem: "no-text" },
        { line: "1914-8-3 Germany declares war on France", problem: "no-date" },
    ]);
    // The same beats the engine parses.
    assert.equal(parseScriptedEvents(text).length, review.count);
    assert.deepEqual(reviewScriptedEvents("", { currentDate: "1914-01-01" }), { count: 0, ignored: [] });
});

test("a beat no skip will reach is flagged; the first skip still covers the day itself", () => {
    const text = "1914-06-28 Sarajevo.\n1914-07-28 Vienna declares war.\n1914-08-01 Berlin declares war.";
    const later = reviewScriptedEvents(text, { currentDate: "1914-07-28" });
    assert.equal(later.count, 1);
    assert.deepEqual(later.ignored.map((entry) => [entry.line, entry.problem]), [
        ["1914-06-28 Sarajevo.", "passed"],
        ["1914-07-28 Vienna declares war.", "passed"],
    ]);
    const first = reviewScriptedEvents(text, { currentDate: "1914-07-28", includeOrigin: true });
    assert.equal(first.count, 2);
    assert.deepEqual(first.ignored.map((entry) => entry.line), ["1914-06-28 Sarajevo."]);
    // Years before AD 1 compare as the engine compares them (scriptedBeatsInSpan).
    assert.equal(reviewScriptedEvents("-0216-08-02 Cannae.", { currentDate: "-0218-03-01" }).count, 1);
    assert.equal(reviewScriptedEvents("-0219-12-01 Too early.", { currentDate: "-0218-03-01" }).ignored[0]?.problem, "passed");
    // No usable date to measure against: nothing is called passed.
    assert.equal(reviewScriptedEvents(text, { currentDate: "" }).count, 3);
});

test("a beat is written when an event near its date shares its particular words", () => {
    const beat = parseScriptedEvents("2014-05-25 Ukraine holds a presidential election; Petro Poroshenko wins outright in the first round.")[0];
    assert.equal(beatIsWritten(beat, [{ date: "2014-05-26", title: "Poroshenko elected", description: "Petro Poroshenko wins Ukraine's presidential election outright." }]), true);
    assert.equal(beatIsWritten(beat, [{ date: "2014-05-25", title: "Fighting near Donetsk", description: "Separatists seize the airport." }]), false, "same day, different event");
    assert.equal(beatIsWritten(beat, [{ date: "2014-07-25", title: "Poroshenko elected", description: "Petro Poroshenko wins Ukraine's presidential election outright." }]), false, "two months out is not this beat");
});

test("a generated selected outcome must remain anchored to its parent event context", () => {
    const beat = {
        date: "2026-01-02",
        title: "Outcome A is selected",
        text: "Outcome A is selected.",
        parentText: "A major test event occurs in Latvia. This event exists only to test Conditional Scripted Events.",
        textMode: "generated",
    };
    const wrongPolity = [{
        date: "2026-01-02",
        title: "Russian Federal Ministries Implement Outcome A Strategic Directives",
        description: "Moscow ministries operationalize Outcome A and redirect Russian federal resources.",
    }];
    const anchored = [{
        date: "2026-01-02",
        title: "Latvia Selects Outcome A",
        description: "Outcome A is selected in Latvia.",
    }];
    assert.equal(beatIsWritten(beat, wrongPolity), false, "matching the branch words alone cannot relocate the authored parent event to the player polity");
    assert.equal(beatIsWritten(beat, anchored), true);

    const repaired = ensureScriptedEvents(wrongPolity, [beat]);
    assert.equal(repaired.inserted.length, 1, "the mis-anchored rewrite does not satisfy the scripted beat");
    assert.equal(repaired.events.at(-1).description, `${beat.parentText}\n\n${beat.text}`, "the deterministic fallback keeps both parent context and selected outcome");
});

test("exact selected-outcome wording uses parent context for the prompt without adding it to visible prose", () => {
    const beat = {
        date: "2026-01-02",
        title: "Outcome A is selected",
        text: "Outcome A is selected.",
        parentText: "A major test event occurs in Latvia.",
        textMode: "exact",
    };
    assert.equal(beatIsWritten(beat, [{ date: beat.date, title: beat.title, description: beat.text }]), true, "exact visible wording need not repeat the parent context");
    const { events } = ensureScriptedEvents([], [beat]);
    assert.equal(events[0].description, beat.text, "exact fallback remains exactly the selected authored wording");
});

test("a beat the answer left out is written by the engine, in the author's words, without impacts", () => {
    const beats = parseScriptedEvents("2014-05-25 Ukraine holds a presidential election; Petro Poroshenko wins outright.\n2014-05-02 Clashes in Odesa leave dozens dead at the Trade Unions House.");
    const answer = [{ date: "2014-05-26", title: "Poroshenko wins", description: "Petro Poroshenko wins the Ukraine presidential election outright." }];
    const { events, written, inserted } = ensureScriptedEvents(answer, beats);
    assert.equal(written.length, 1);
    assert.equal(inserted.length, 1);
    assert.equal(events.length, 2);
    const engineWrote = events[1];
    assert.equal(engineWrote.date, "2014-05-02");
    assert.equal(engineWrote.description, "Clashes in Odesa leave dozens dead at the Trade Unions House.");
    assert.equal(engineWrote.kind, "world");
    assert.equal(engineWrote.notable, true);
    assert.deepEqual(engineWrote.impacts, {});
    assert.equal(answer.length, 1, "the answer itself is not mutated");
});

test("the period is told its beats, dated, and what happens to one it leaves out", () => {
    const beats = parseScriptedEvents("1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.");
    const text = buildScriptedEventsInstruction(beats);
    assert.match(text, /^\[Scripted events this period/);
    assert.match(text, /- 1914-06-28 — Archduke Franz Ferdinand is assassinated in Sarajevo\./);
    assert.match(text, /written by the engine/);
    assert.equal(buildScriptedEventsInstruction([]), "");
});


test("exact scripted wording replaces AI presentation but preserves canonical impacts", () => {
    const beat = {
        date: "2014-05-25",
        title: "Author headline",
        text: "These are the exact words the author wrote.",
        textMode: "exact",
    };
    const answer = [{
        date: "2014-05-25",
        title: "AI rewrites the headline",
        description: "The author wrote these exact words, but the AI padded them with extra prose.",
        quote: { text: "Extra AI quote", speaker: "Someone" },
        impacts: { politicalActorOps: [{ operation: "replace-leader", polityId: "X", leaderId: "Y" }] },
    }];
    const { events, written, inserted } = ensureScriptedEvents(answer, [beat]);
    assert.equal(written.length, 1);
    assert.equal(inserted.length, 0);
    assert.equal(events[0].date, beat.date);
    assert.equal(events[0].title, beat.title);
    assert.equal(events[0].description, beat.text);
    assert.equal(events[0].quote, undefined, "AI-added visible prose is removed in exact mode");
    assert.deepEqual(events[0].impacts, answer[0].impacts, "canonical consequences survive the presentation lock");
});

test("generated scripted wording keeps the simulator's presentation", () => {
    const beat = { date: "2014-05-25", title: "Author instruction", text: "A named reform passes in parliament.", textMode: "generated" };
    const answer = [{ date: "2014-05-25", title: "Parliament passes the reform", description: "Lawmakers approve the named reform after debate.", impacts: {} }];
    const { events } = ensureScriptedEvents(answer, [beat]);
    assert.equal(events[0].title, answer[0].title);
    assert.equal(events[0].description, answer[0].description);
});

test("the period tells the simulator which scripted beats have exact wording", () => {
    const text = buildScriptedEventsInstruction([
        { date: "2030-01-01", text: "AI may rewrite this.", textMode: "generated" },
        { date: "2030-01-02", text: "Use exactly these words.", textMode: "exact" },
    ]);
    assert.match(text, /Ordinary entries are instructions: write their final event in your own words/);
    assert.match(text, /\[EXACT WORDING\] Use exactly these words\./);
    assert.match(text, /preserving those impacts/);
});

test("the period gives a selected branch both its parent event and its chosen outcome", () => {
    const text = buildScriptedEventsInstruction([{
        date: "2026-01-02",
        text: "Outcome A is selected.",
        parentText: "A major test event occurs in Latvia.",
        textMode: "generated",
    }]);
    assert.match(text, /Parent event: A major test event occurs in Latvia\./);
    assert.match(text, /Selected outcome: Outcome A is selected\./);
    assert.match(text, /does not replace its people, places, actors or subject/);
});

// --- the map's tempo ---

test("the allowance is the ceiling scaled to the period, never below one; 0 is no ceiling", () => {
    assert.equal(territoryTempoAllowance(3, 30), 3);
    assert.equal(territoryTempoAllowance(3, 10), 1);
    assert.equal(territoryTempoAllowance(3, 90), 9);
    assert.equal(territoryTempoAllowance(0, 30), Infinity);
    assert.equal(territoryTempoAllowance(null, 30), Infinity);
});

test("transfers and captures beyond the allowance are withheld in event order; contests are not counted", () => {
    const events = [
        { date: "2014-05-01", title: "A", impacts: { regionTransfers: [{ regionId: "r1", toCode: "X" }, { regionId: "r2", toCode: "X" }], regionControlOps: [{ op: "contest", regionId: "r9", fromCode: "Y", actorCode: "X" }] } },
        { date: "2014-05-10", title: "B", impacts: { regionControlOps: [{ op: "control", regionId: "r3", fromCode: "Y", toCode: "X" }, { op: "clear_contest", regionId: "r9" }] } },
        { date: "2014-05-20", title: "C", impacts: { regionTransfers: [{ regionId: "r4", toCode: "X" }] } },
    ];
    const { events: next, withheld, allowance } = applyTerritoryTempo(events, { ceilingPerMonth: 3, spanDays: 30 });
    assert.equal(allowance, 3);
    assert.equal(withheld, 1);
    assert.equal(next[0].impacts.regionTransfers.length, 2);
    assert.equal(next[0].impacts.regionControlOps.length, 1, "the contest stays");
    assert.equal(next[1].impacts.regionControlOps.length, 2, "the capture is the third and last allowed; the clearing is free");
    assert.deepEqual(next[2].impacts.regionTransfers, [], "the fourth region is withheld");
    assert.equal(events[2].impacts.regionTransfers.length, 1, "the input is not mutated");
    assert.equal(applyTerritoryTempo(events, { ceilingPerMonth: 0, spanDays: 30 }).withheld, 0);
});

test("a whole-country entry is the ceiling's worth by itself", () => {
    const events = [
        { impacts: { regionTransfers: [{ regionId: "Y", toCode: "X", wholeCountry: true }, { regionId: "r2", toCode: "X" }] } },
    ];
    const { events: next, withheld } = applyTerritoryTempo(events, { ceilingPerMonth: 5, spanDays: 30 });
    assert.equal(withheld, 1);
    assert.equal(next[0].impacts.regionTransfers.length, 1);
    assert.equal(next[0].impacts.regionTransfers[0].wholeCountry, true);
});

test("the simulator is told the tempo as a number for the period", () => {
    const directive = buildWorldDirectionDirective({ worldShare: 0, priorityRules: "", territoryTempo: 2 }, { playerPolity: "France", spanDays: 45 });
    assert.match(directive, /^\[The Map's Tempo — counted by the engine\]/);
    assert.match(directive, /no faster than 2 regions per thirty days: 3 this period/);
    assert.equal(buildWorldDirectionDirective({ worldShare: 0, priorityRules: "", territoryTempo: 0 }), "");
});

test("the priority rules alone: no share, no tempo, nothing without rules", () => {
    const direction = { worldShare: 35, territoryTempo: 2, priorityRules: "No nuclear weapons before 1945." };
    const block = buildPriorityRulesBlock(direction);
    assert.ok(block.startsWith(PRIORITY_RULES_HEADING));
    assert.match(block, /outrank everything else you have been told/);
    assert.ok(block.endsWith("No nuclear weapons before 1945."));
    assert.doesNotMatch(block, /World's Share|Map's Tempo/);
    assert.equal(buildPriorityRulesBlock({ worldShare: 35, priorityRules: "  " }), "");
    assert.equal(buildPriorityRulesBlock(null), "");
});

test("the time skip's directive carries the same rules block as every other task", () => {
    const direction = { worldShare: 35, priorityRules: "The Tsar never abdicates." };
    const directive = buildWorldDirectionDirective(direction, { playerPolity: "France" });
    assert.ok(directive.endsWith(buildPriorityRulesBlock(direction)));
});
