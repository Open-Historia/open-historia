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

// --- a timeline that is not written in Latin letters ---
//
// The word-for-word check compares two events of one date by their text with
// case and punctuation folded away, and the fold kept a-z0-9 only. An event
// written in Russian or Chinese was then nothing but the Latin letters and
// digits in it, usually nothing at all: a new event dated the same day as one
// on record was "the same text" as it, and was removed as an exact repeat with
// no analyst asked. Found reading the code for a player whose game is played
// in Russian (2026-10-05); the two events below are removed by the old fold.
const RU_PRIOR = [
    event("Правительство утверждает бюджет", "Кабинет министров одобрил проект бюджета на следующий год и направил его в Думу.", { id: "ru-p1", date: "2014-09-12" }),
    event("Начало учебного года", "По всей стране открылись школы.", { id: "ru-p2", date: "2014-09-01" }),
];
const ZH_PRIOR = [
    event("政府批准预算", "内阁批准了明年的预算草案并提交议会审议。", { id: "zh-p1", date: "2014-09-12" }),
];

test("different events of one day are different events in Cyrillic and in Chinese", async () => {
    for (const [prior, events] of [
        [RU_PRIOR, [
            event("Черноморский флот выходит в море", "Отряд кораблей покинул Севастополь и взял курс на юг.", { id: "ru-n1", date: "2014-09-12" }),
            event("Землетрясение на Камчатке", "Подземные толчки ощущались в Петропавловске; разрушений нет.", { id: "ru-n2", date: "2014-09-12" }),
        ]],
        [ZH_PRIOR, [
            event("黑海舰队出海", "一支舰艇编队离开塞瓦斯托波尔向南航行。", { id: "zh-n1", date: "2014-09-12" }),
            event("堪察加发生地震", "彼得罗巴甫洛夫斯克有震感，未造成破坏。", { id: "zh-n2", date: "2014-09-12" }),
        ]],
    ]) {
        const result = await curateGeneratedEventsWithHidden({ events, priorEvents: prior, game: {}, world: {}, actions: [], mode: "jump", analyzeBatch: null });
        assert.deepEqual(result.events.map((entry) => entry.id), events.map((entry) => entry.id), "both are kept");
        assert.deepEqual(result.dropped, []);
    }
});

test("a word-for-word repeat is still removed in Cyrillic, case and punctuation aside", async () => {
    const repeat = { ...RU_PRIOR[0], id: "ru-again", title: "ПРАВИТЕЛЬСТВО УТВЕРЖДАЕТ БЮДЖЕТ!" };
    assert.deepEqual(candidatesWorthJudging({ events: [repeat], priorEvents: RU_PRIOR }), []);
    const result = await curateGeneratedEventsWithHidden({ events: [repeat], priorEvents: RU_PRIOR, game: {}, world: {}, actions: [], mode: "jump", analyzeBatch: null });
    assert.deepEqual(result.events, []);
    assert.equal(result.dropped[0]?.route, "EXACT_DUPLICATE");
});

test("an event that closely resembles recent history is worth a judgment in Cyrillic too", () => {
    const prior = [
        event("Артиллерийские обстрелы у донецкого аэропорта продолжаются", "Правительственные и сепаратистские батареи обмениваются огнём у донецкого аэропорта; позиции не меняются.", { id: "ru-a1", date: "2014-02-12" }),
        event("Артиллерийские обстрелы у донецкого аэропорта не прекращаются", "Обстрелы вокруг донецкого аэропорта идут всю неделю; линии не сдвинулись.", { id: "ru-a2", date: "2014-02-20" }),
    ];
    const again = [event("Артиллерийские обстрелы у донецкого аэропорта продолжаются", "Правительственные и сепаратистские батареи снова обмениваются огнём у донецкого аэропорта; позиции не меняются.", { id: "ru-a3", date: "2014-03-10" })];
    assert.deepEqual(candidatesWorthJudging({ events: again, priorEvents: prior }), [0], "it has words to resemble them by");
    const fresh = [event("Ледокол спущен на воду в Мурманске", "Атомный ледокол сошёл со стапеля на глазах у рабочих верфи.", { id: "ru-a4", date: "2014-03-10" })];
    assert.deepEqual(candidatesWorthJudging({ events: fresh, priorEvents: prior }), []);
});
