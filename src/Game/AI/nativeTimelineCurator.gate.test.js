/*! Open Historia — is a timeline judgment worth a request: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeTimelineCurator.gate.test.js
//
// Runs without node_modules: nativeTimelineCurator.js imports nothing.
//
// candidatesWorthJudging decides whether a time skip pays a second request. It
// may only say "no" when the analyst could not have removed anything anyway, so
// the second half of this file runs the curator itself with the harshest
// possible analyst and checks that every event the gate waved through survives.

import test from "node:test";
import assert from "node:assert/strict";

import { candidatesWorthJudging, curateGeneratedEventsWithHidden } from "./nativeTimelineCurator.js";

const event = (title, description, extra = {}) => ({
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    date: "2014-03-10",
    title,
    description,
    importance: "medium",
    impacts: {},
    ...extra,
});

const PRIOR = [
    event("Grain harvest fails in the Volga basin", "Drought ruins the wheat crop across the Volga basin and bread prices climb in Saratov.", { date: "2014-02-01" }),
    event("Artillery exchanges continue near Donetsk airport", "Government and separatist batteries trade fire around Donetsk airport with no change in positions.", { date: "2014-02-12" }),
    event("Artillery exchanges persist near Donetsk airport", "Shelling around Donetsk airport carries on through the week; the lines do not move.", { date: "2014-02-20" }),
];

test("a fresh development that resembles nothing on record needs no judgment", () => {
    const events = [event("Icebreaker launched at Murmansk", "The nuclear icebreaker Sibir slides down the ways at Murmansk before a crowd of shipyard workers.")];
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: PRIOR }), []);
});

test("an event that closely resembles recent history is worth a judgment", () => {
    const events = [event("Artillery exchanges continue near Donetsk airport", "Government and separatist batteries again trade fire around Donetsk airport with no change in positions.", { date: "2014-03-10" })];
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: PRIOR }), [0]);
});

test("a meeting or a review is worth a judgment even with nothing like it on record", () => {
    const events = [event("Finance ministers convene in Astana", "Delegations meet to review customs procedures and discuss a timetable for further talks.")];
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: [] }), [0]);
});

test("an event with a hard consequence is never worth one: it is kept whatever is said", () => {
    const events = [event(
        "Artillery exchanges continue near Donetsk airport",
        "Government and separatist batteries again trade fire around Donetsk airport with no change in positions.",
        { impacts: { unitOps: [{ op: "strength", unitId: "u1", strength: 300 }] } },
    )];
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: PRIOR }), []);
    const atWar = [event("Artillery exchanges continue near Donetsk airport", "Batteries trade fire around Donetsk airport.", { warId: "war-1" })];
    assert.deepEqual(candidatesWorthJudging({ events: atWar, priorEvents: PRIOR }), []);
});

test("a word-for-word repeat on the same date is removed without an analyst, so it asks for none", () => {
    const repeat = { ...PRIOR[1] };
    assert.deepEqual(candidatesWorthJudging({ events: [repeat], priorEvents: PRIOR }), []);
});

test("only a time skip is curated at all", () => {
    const events = [event("Finance ministers convene in Astana", "Delegations meet to review customs procedures.")];
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: [], mode: "interactive" }), []);
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: [], mode: "auto" }), [0]);
    assert.deepEqual(candidatesWorthJudging(), []);
});

test("the indexes are the candidates' own positions", () => {
    const events = [
        event("Icebreaker launched at Murmansk", "The nuclear icebreaker Sibir slides down the ways at Murmansk."),
        event("Finance ministers convene in Astana", "Delegations meet to review customs procedures."),
        event("Observatory opens on Mount Elbrus", "Astronomers take first light at a new mountain observatory."),
        event("Artillery exchanges continue near Donetsk airport", "Government and separatist batteries again trade fire around Donetsk airport with no change in positions."),
    ];
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: PRIOR }), [1, 3]);
});

// A harsh analyst: every candidate is a redundant, worthless, incremental repeat
// of everything on record, with total confidence. `overrides` lets a test push
// it further, into the two openings the gate knowingly gives up.
const harshAnalyst = (overrides = {}, saturation = { count: 1, saturation: "low" }) => ({ candidates, priorHistory }) => ({
    payload: {
        judgments: candidates.map((candidate) => ({
            index: candidate.index,
            verdict: "REDUNDANT",
            confidence: 1,
            materialStateChange: "",
            matchedPriorIndexes: priorHistory.map((row) => row.priorIndex),
            materiallyNewDimensions: [],
            recurrenceMatters: false,
            newTriggerAfterPriorPosture: "none",
            worthwhile: false,
            substantive: false,
            personalityTexture: false,
            storyline: "everything",
            qualitativeAdvance: false,
            incrementalProcess: true,
            processFramePresent: false,
            observableOutcomeEvidence: "",
            pureProcessFiller: false,
            reason: "harsh",
            ...overrides,
        })),
        recentHistoryMechanical: true,
        storylineSaturation: [{ storyline: "everything", ...saturation }],
        underrepresentedDomains: [],
    },
});

const MIXED = [
    event("Icebreaker launched at Murmansk", "The nuclear icebreaker Sibir slides down the ways at Murmansk before a crowd of shipyard workers."),
    event("Observatory opens on Mount Elbrus", "Astronomers take first light at a new mountain observatory above the Baksan valley."),
    event("Finance ministers convene in Astana", "Delegations meet to review customs procedures and discuss a timetable for further talks."),
    event("Artillery exchanges continue near Donetsk airport", "Government and separatist batteries again trade fire around Donetsk airport with no change in positions."),
];

const curateWith = (analyzeBatch) => curateGeneratedEventsWithHidden({
    events: MIXED, priorEvents: PRIOR, game: {}, world: {}, actions: [], mode: "jump", analyzeBatch,
});

test("what the gate waves through, a harsh analyst could not have removed", async () => {
    const worth = new Set(candidatesWorthJudging({ events: MIXED, priorEvents: PRIOR }));
    assert.deepEqual([...worth], [2, 3]);
    const result = await curateWith(harshAnalyst());
    const keptTitles = new Set(result.events.map((entry) => entry.title));
    MIXED.forEach((entry, index) => {
        if (!worth.has(index)) assert.ok(keptTitles.has(entry.title), `"${entry.title}" was waved through and must survive`);
    });
    // And the analyst is not toothless here: it does remove what the gate sent it.
    assert.ok(result.events.length < MIXED.length, "the fixture must show the analyst removing something");
});

// The trade, written down. Two routes rest on the analyst's word alone — a
// storyline it calls crowded, a process frame only it can see — so an event the
// gate waved through CAN be removed by them when a review happens to run. What
// the gate gives up is only ever asking for a review on their account. If either
// test below starts failing, a route gained or lost a native condition, and the
// gate's comment in nativeTimelineCurator.js must change with it.
test("known opening: a storyline only the analyst calls crowded", async () => {
    const result = await curateWith(harshAnalyst({}, { count: 9, saturation: "saturated" }));
    const dropped = result.dropped.find((row) => row.title === "Icebreaker launched at Murmansk");
    assert.equal(dropped?.route, "LOW_VALUE_INCREMENTAL_CHURN");
});

test("known opening: a process frame only the analyst sees", async () => {
    const result = await curateWith(harshAnalyst({ verdict: "KEEP", pureProcessFiller: true }));
    const dropped = result.dropped.find((row) => row.title === "Observatory opens on Mount Elbrus");
    assert.equal(dropped?.route, "NATIVE_PROCESS_FILLER");
});
