/*! Open Historia — is a timeline judgment worth a request: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeTimelineCurator.gate.test.js
//
// Runs without node_modules: nativeTimelineCurator.js imports nothing.
//
// candidatesWorthJudging decides whether the curator's analyst is asked. It
// reads the record's structure alone, never an event's words: an event with a
// hard consequence is kept whatever is said, and the routes that rest on
// history need a prior event on the candidate's own storyline (the storyline
// ids events carry). The second half runs the curator itself with the harshest
// possible analyst and checks which events it can and cannot remove.

import test from "node:test";
import assert from "node:assert/strict";

import { candidatesWorthJudging, curateGeneratedEventsWithHidden } from "./nativeTimelineCurator.js";

const event = (title, description, extra = {}) => ({
    id: title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-"),
    date: "2014-03-10",
    title,
    description,
    importance: "medium",
    impacts: {},
    ...extra,
});

const PRIOR = [
    event("Grain harvest fails in the Volga basin", "Drought ruins the wheat crop across the Volga basin and bread prices climb in Saratov.", { date: "2014-02-01", storylineIds: ["volga-famine"] }),
    event("Artillery exchanges continue near Donetsk airport", "Government and separatist batteries trade fire around Donetsk airport with no change in positions.", { date: "2014-02-12", storylineIds: ["donbas-front"] }),
    event("Artillery exchanges persist near Donetsk airport", "Shelling around Donetsk airport carries on through the week; the lines do not move.", { date: "2014-02-20", storylineIds: ["donbas-front"] }),
];

const SHELLING = event(
    "Artillery exchanges continue near Donetsk airport",
    "Government and separatist batteries again trade fire around Donetsk airport with no change in positions.",
    { storylineIds: ["donbas-front"] },
);

test("a fresh development on no storyline on record needs no judgment", () => {
    const events = [event("Icebreaker launched at Murmansk", "The nuclear icebreaker Sibir slides down the ways at Murmansk before a crowd of shipyard workers.")];
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: PRIOR }), []);
    // A storyline that has nothing on record yet is no repeat of anything either.
    const opening = [{ ...events[0], storylineIds: ["arctic-fleet"] }];
    assert.deepEqual(candidatesWorthJudging({ events: opening, priorEvents: PRIOR }), []);
});

test("an event that continues a storyline on record is worth a judgment", () => {
    assert.deepEqual(candidatesWorthJudging({ events: [SHELLING], priorEvents: PRIOR }), [0]);
});

test("an event's words decide nothing: alike words without a shared storyline ask for no judgment", () => {
    // Word for word what is on record, but on no storyline: the analyst could
    // cite no prior event it shares a storyline with.
    const words = [{ ...SHELLING, storylineIds: [] }];
    assert.deepEqual(candidatesWorthJudging({ events: words, priorEvents: PRIOR }), []);
    // A meeting is a meeting in any language; only the analyst can say so.
    const meeting = [event("Finance ministers convene in Astana", "Delegations meet to review customs procedures and discuss a timetable for further talks.")];
    assert.deepEqual(candidatesWorthJudging({ events: meeting, priorEvents: [] }), []);
});

test("an event with a hard consequence is never worth one: it is kept whatever is said", () => {
    const events = [{ ...SHELLING, impacts: { unitOps: [{ op: "strength", unitId: "u1", strength: 300 }] } }];
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: PRIOR }), []);
    const atWar = [{ ...SHELLING, warId: "war-1" }];
    assert.deepEqual(candidatesWorthJudging({ events: atWar, priorEvents: PRIOR }), []);
});

test("only a time skip is curated at all", () => {
    assert.deepEqual(candidatesWorthJudging({ events: [SHELLING], priorEvents: PRIOR, mode: "interactive" }), []);
    assert.deepEqual(candidatesWorthJudging({ events: [SHELLING], priorEvents: PRIOR, mode: "auto" }), [0]);
    assert.deepEqual(candidatesWorthJudging(), []);
});

test("the indexes are the candidates' own positions", () => {
    const events = [
        event("Icebreaker launched at Murmansk", "The nuclear icebreaker Sibir slides down the ways at Murmansk."),
        event("Bread rationing extended in Saratov", "Ration cards now cover flour and sugar.", { storylineIds: ["volga-famine"] }),
        event("Observatory opens on Mount Elbrus", "Astronomers take first light at a new mountain observatory."),
        SHELLING,
    ];
    assert.deepEqual(candidatesWorthJudging({ events, priorEvents: PRIOR }), [1, 3]);
});

test("only the prior events the analyst is shown count: a storyline's event older than the window does not", () => {
    const old = event("Artillery exchanges begin near Donetsk airport", "The first shells fall on the airport.", { date: "2014-01-02", storylineIds: ["donbas-front"] });
    const filler = Array.from({ length: 50 }, (_, index) => event(`Quiet day ${index}`, "Nothing of note.", { date: "2014-02-01" }));
    assert.deepEqual(candidatesWorthJudging({ events: [SHELLING], priorEvents: [old, ...filler] }), []);
    assert.deepEqual(candidatesWorthJudging({ events: [SHELLING], priorEvents: [old, ...filler.slice(1)] }), [0]);
});

// A harsh analyst: every candidate is a redundant, worthless, incremental repeat
// of everything on record, with total confidence. `overrides` lets a test push
// it further, into the routes that rest on its word alone.
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
            newTriggerAfterPriorPosture: "",
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
            newTrigger: false,
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
    SHELLING,
];

const curateWith = (analyzeBatch, events = MIXED, priorEvents = PRIOR) => curateGeneratedEventsWithHidden({
    events, priorEvents, game: {}, world: {}, actions: [], mode: "jump", analyzeBatch,
});

test("what the gate waves through, a harsh analyst cannot remove by history", async () => {
    const worth = new Set(candidatesWorthJudging({ events: MIXED, priorEvents: PRIOR }));
    assert.deepEqual([...worth], [3]);
    const result = await curateWith(harshAnalyst());
    const keptTitles = new Set(result.events.map((entry) => entry.title));
    MIXED.forEach((entry, index) => {
        if (!worth.has(index)) assert.ok(keptTitles.has(entry.title), `"${entry.title}" was waved through and must survive`);
    });
    // And the analyst is not toothless: it removes the repeat on the storyline,
    // by the prior events it cites there.
    assert.deepEqual(result.dropped.map((row) => [row.title, row.route]), [[SHELLING.title, "EVIDENCED_REDUNDANCY"]]);
});

test("a cited prior event on another storyline is no evidence of a repeat", async () => {
    // The analyst cites only the famine (prior 0); the shelling is on the front.
    const result = await curateWith(harshAnalyst({ matchedPriorIndexes: [0] }));
    assert.equal(result.events.length, MIXED.length);
});

// Three routes rest on the analyst's word alone — a storyline it calls crowded,
// a process frame only it can see, a routine military step — so an event the
// gate waved through CAN be removed by them when a review happens to run. The
// gate never asks on their account. If a test below starts failing, a route
// gained or lost a native condition, and the gate's comment in
// nativeTimelineCurator.js must change with it.
test("known opening: a storyline only the analyst calls crowded", async () => {
    const result = await curateWith(harshAnalyst({}, { count: 9, saturation: "saturated" }));
    const dropped = result.dropped.find((row) => row.title === "Icebreaker launched at Murmansk");
    assert.equal(dropped?.route, "LOW_VALUE_INCREMENTAL_CHURN");
});

test("known opening: a process frame only the analyst sees", async () => {
    const result = await curateWith(harshAnalyst({ verdict: "KEEP", pureProcessFiller: true }));
    const dropped = result.dropped.find((row) => row.title === "Observatory opens on Mount Elbrus");
    assert.equal(dropped?.route, "NATIVE_PROCESS_FILLER");
    // A process frame the analyst sees, and no outcome it quotes, is filler too.
    const framed = await curateWith(harshAnalyst({ verdict: "KEEP", processFramePresent: true }));
    assert.equal(framed.dropped.find((row) => row.title === "Finance ministers convene in Astana")?.route, "NATIVE_PROCESS_FILLER");
    // The outcome it quotes keeps the event, in whatever words it quotes it.
    const quoted = await curateWith(harshAnalyst({ verdict: "KEEP", processFramePresent: true, observableOutcomeEvidence: "договорились о графике" }));
    assert.equal(quoted.dropped.some((row) => row.route === "NATIVE_PROCESS_FILLER"), false);
});

test("known opening: a routine military step is the event's own Military tag, never its words", async () => {
    const patrol = event("Border patrols probe the frontier", "Patrols trade fire again along the river; nothing changes.", { tags: ["Military"] });
    const untagged = { ...patrol, id: "untagged", tags: ["Politics"] };
    // The shelling continues a storyline, so a review runs; the patrols ride along.
    assert.deepEqual(candidatesWorthJudging({ events: [patrol, untagged, SHELLING], priorEvents: PRIOR }), [2]);
    const result = await curateWith(harshAnalyst({ verdict: "KEEP" }), [patrol, untagged, SHELLING], PRIOR);
    assert.deepEqual(result.dropped.map((row) => [row.title, row.route]), [[patrol.title, "ROUTINE_MILITARY_NO_DELTA"]]);
    // A new dimension in the analyst's answer (casualties, a capture) keeps it.
    const costly = await curateWith(harshAnalyst({ verdict: "KEEP", materiallyNewDimensions: ["casualties"] }), [patrol, SHELLING], PRIOR);
    assert.deepEqual(costly.dropped, []);
});

test("a reversal is dropped only without a new trigger, which is the analyst's boolean", async () => {
    const reversal = (overrides) => harshAnalyst({ verdict: "UNSUPPORTED_REVERSAL", ...overrides });
    const none = await curateWith(reversal({ newTrigger: false }), [SHELLING]);
    assert.equal(none.dropped[0]?.route, "UNSUPPORTED_REVERSAL");
    const triggered = await curateWith(reversal({ newTrigger: true }), [SHELLING]);
    assert.deepEqual(triggered.dropped, []);
    // An answer without the boolean: an empty trigger is none; one it names is a
    // trigger, in any language, and the sentinel word "none" is no longer read.
    const legacy = (text) => reversal({ newTrigger: undefined, newTriggerAfterPriorPosture: text });
    assert.equal((await curateWith(legacy(""), [SHELLING])).dropped[0]?.route, "UNSUPPORTED_REVERSAL");
    assert.deepEqual((await curateWith(legacy("Обстрел посольства"), [SHELLING])).dropped, []);
    assert.deepEqual((await curateWith(legacy("none"), [SHELLING])).dropped, []);
});

test("the player's Cancel during the analyst's request reaches the skip; any other failure keeps everything", async () => {
    const controller = new AbortController();
    await assert.rejects(
        curateGeneratedEventsWithHidden({
            events: MIXED, priorEvents: PRIOR, mode: "jump", signal: controller.signal,
            analyzeBatch: async () => {
                controller.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
                throw controller.signal.reason;
            },
        }),
        (error) => error?.name === "AbortError",
    );
    const kept = await curateWith(async () => { throw new Error("model unavailable"); });
    assert.equal(kept.events.length, MIXED.length);
});

test("the curator makes no request when no event is worth a judgment", async () => {
    let asked = 0;
    const counting = (analyst) => async (input) => { asked += 1; return analyst(input); };
    // Every event has a hard consequence: kept whatever the analyst would say.
    const consequential = [
        { ...SHELLING, warId: "war-1" },
        event("Finance ministers convene in Astana", "Delegations meet to review customs procedures.", { storylineIds: ["volga-famine"], impacts: { regionTransfers: [{ regionId: "r1", fromCode: "A", toCode: "B" }] } }),
        event("Icebreaker launched at Murmansk", "The nuclear icebreaker Sibir slides down the ways.", { impacts: { unitOps: [{ op: "strength", unitId: "u1", strength: 300 }] } }),
    ];
    const quiet = await curateGeneratedEventsWithHidden({
        events: consequential, priorEvents: PRIOR, mode: "jump", analyzeBatch: counting(harshAnalyst()),
    });
    assert.equal(asked, 0);
    assert.equal(quiet.events.length, consequential.length);
    // One event it could remove is enough to ask.
    await curateWith(counting(harshAnalyst()));
    assert.equal(asked, 1);
});

// --- a timeline that is not written in Latin letters ---
//
// The curator once compared events by their words: a fold that kept a-z0-9
// made every Russian or Chinese event of one day "the same text", and a
// word-overlap score decided what resembled the record. Nothing reads the
// words now, so an event and its translation are judged the same way.
const RU_PRIOR = [
    event("Артиллерийские обстрелы у донецкого аэропорта продолжаются", "Правительственные и сепаратистские батареи обмениваются огнём у донецкого аэропорта; позиции не меняются.", { id: "ru-a1", date: "2014-02-12", storylineIds: ["donbas-front"] }),
    event("Артиллерийские обстрелы у донецкого аэропорта не прекращаются", "Обстрелы вокруг донецкого аэропорта идут всю неделю; линии не сдвинулись.", { id: "ru-a2", date: "2014-02-20", storylineIds: ["donbas-front"] }),
];
const RU_SHELLING = event("Обстрелы у донецкого аэропорта продолжаются", "Батареи снова обмениваются огнём; позиции не меняются.", { id: "ru-a3", storylineIds: ["donbas-front"] });
const ZH_SHELLING = event("顿涅茨克机场附近炮战持续", "双方炮兵再次交火，阵地没有变化。", { id: "zh-a3", storylineIds: ["donbas-front"] });

test("a storyline continued in Russian or Chinese is judged exactly as it is in English", async () => {
    for (const [prior, candidate] of [[PRIOR, SHELLING], [RU_PRIOR, RU_SHELLING], [RU_PRIOR, ZH_SHELLING], [PRIOR, ZH_SHELLING]]) {
        assert.deepEqual(candidatesWorthJudging({ events: [candidate], priorEvents: prior }), [0], candidate.title);
        const result = await curateWith(harshAnalyst(), [candidate], prior);
        assert.deepEqual(result.dropped.map((row) => row.route), ["EVIDENCED_REDUNDANCY"], candidate.title);
    }
    // And off the storyline, in any script, nothing on record is a repeat of it.
    const fresh = event("Ледокол спущен на воду в Мурманске", "Атомный ледокол сошёл со стапеля на глазах у рабочих верфи.", { id: "ru-a4" });
    assert.deepEqual(candidatesWorthJudging({ events: [fresh], priorEvents: RU_PRIOR }), []);
    assert.deepEqual((await curateWith(harshAnalyst(), [fresh], RU_PRIOR)).dropped, []);
});

test("different events of one day are different events in Cyrillic and in Chinese", async () => {
    const prior = [
        event("Правительство утверждает бюджет", "Кабинет министров одобрил проект бюджета на следующий год и направил его в Думу.", { id: "ru-p1", date: "2014-09-12" }),
        event("政府批准预算", "内阁批准了明年的预算草案并提交议会审议。", { id: "zh-p1", date: "2014-09-12" }),
    ];
    const events = [
        event("Черноморский флот выходит в море", "Отряд кораблей покинул Севастополь и взял курс на юг.", { id: "ru-n1", date: "2014-09-12" }),
        event("堪察加发生地震", "彼得罗巴甫洛夫斯克有震感，未造成破坏。", { id: "zh-n2", date: "2014-09-12" }),
    ];
    const result = await curateGeneratedEventsWithHidden({ events, priorEvents: prior, game: {}, world: {}, actions: [], mode: "jump", analyzeBatch: null });
    assert.deepEqual(result.events.map((entry) => entry.id), events.map((entry) => entry.id), "both are kept");
    assert.deepEqual(result.dropped, []);
});

test("a word-for-word repeat is not the curator's to remove: the record's own dedupe takes it out first", async () => {
    // applySimulationResult runs dedupeGeneratedEvents (runtime/eventDedup.js)
    // before the curator sees a candidate. Here, with no analyst, it is kept.
    const repeat = { ...PRIOR[1], id: "again" };
    assert.deepEqual(candidatesWorthJudging({ events: [{ ...repeat, storylineIds: [] }], priorEvents: PRIOR }), []);
    const result = await curateGeneratedEventsWithHidden({ events: [repeat], priorEvents: PRIOR, game: {}, world: {}, actions: [], mode: "jump", analyzeBatch: null });
    assert.deepEqual(result.events.map((entry) => entry.id), ["again"]);
});
