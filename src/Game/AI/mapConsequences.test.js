/*! Open Historia — the map consequences of a batch of events: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/mapConsequences.test.js
//
// A jump's events and a Scene's outcome reach the map the same way: the unit,
// territory and structure Directors each read them, and their accepted changes
// ride on the events. Seen in a live game (2026-09-27): a Scene established a
// unified military command's headquarters in Ouagadougou and nothing appeared,
// because a Scene outcome never reached a Director at all.

import test from "node:test";
import assert from "node:assert/strict";

import { applyMapConsequences, markOrderedEvents, markSceneOutcome } from "./mapConsequences.js";
import { eventNeedsNativeUnitDirector } from "./nativeUnitDirector.js";
import { eventNeedsStructureDirector } from "./nativeStructureDirector.js";

// A Scene's outcome, marked as the player's own doing by the beats that led to it.
const headquarters = markSceneOutcome({
    title: "Establishment of Alliance of Sahel States Unified Military Command",
    description: "President Traore finalized the establishment of the Unified Military Command headquarters in Ouagadougou and raised a new joint rapid-reaction battalion to guard it.",
    date: "2026-01-08",
    kind: "interactive",
    impacts: {},
}, [{ choice: "Order the command's headquarters built in Ouagadougou", summary: "Work begins." }]);
const { ordered: _hint, ...headquartersAsWritten } = headquarters;
const world = { units: [], markers: [], projects: [] };
const answer = (payload) => async () => ({ payload });
const structureAnswer = answer({
    eventOrders: [{ eventIndex: 0, structures: [{ name: "AES Unified Command Headquarters", kind: "military hq", ownerCode: "Burkina Faso", lng: -1.53, lat: 12.37 }] }],
});
const unitAnswer = answer({
    eventOrders: [{ eventIndex: 0, unitOps: [{ op: "spawn", unit: { name: "AES Joint Rapid-Reaction Battalion", type: "infantry", ownerCode: "Burkina Faso", strength: 100, lng: -1.5, lat: 12.4 } }] }],
});
const consequences = (options) => applyMapConsequences({
    events: [headquarters],
    world,
    game: { country: "Burkina Faso" },
    playerCountry: "Burkina Faso",
    resolveControl: async () => {},
    ...options,
});

test("a Scene outcome that builds and raises something gets its structure and its unit", async () => {
    const { events, structureLinks } = await consequences({ analyze: { units: unitAnswer, territory: null, structures: structureAnswer } });
    const impacts = events[0].impacts;
    assert.equal(impacts.markerOps?.[0]?.op, "build");
    assert.equal(impacts.markerOps[0].marker.name, "AES Unified Command Headquarters");
    assert.equal(impacts.unitOps?.[0]?.op, "spawn");
    assert.deepEqual(structureLinks, []);
});

test("a check that is switched off, or had nothing to look at, changes nothing", async () => {
    const { events, structureLinks } = await consequences({ analyze: { units: null, territory: null, structures: null } });
    assert.deepEqual(events, [headquartersAsWritten]);
    assert.deepEqual(structureLinks, []);
});

test("a check that fails costs only its own changes, and the event stands as written", async () => {
    const failing = async () => { throw new Error("the model is busy"); };
    const { events } = await consequences({ analyze: { units: failing, territory: null, structures: structureAnswer } });
    assert.equal(events[0].title, headquarters.title);
    assert.equal(events[0].impacts.unitOps, undefined);
    assert.equal(events[0].impacts.markerOps?.length, 1, "the structure still lands");
});

// The player's Cancel is not a failed check. Each Director catches every failure
// of its own analysis and carries on, so it is handed the signal too: a turn
// cancelled while one is being asked ends there instead of going on to be
// written without that Director's changes.
test("a turn cancelled while a Director is asked stops, and no later Director is asked", async () => {
    const controller = new AbortController();
    let askedAfter = 0;
    const cancelled = async () => {
        controller.abort();
        throw new DOMException("Timeline jump cancelled.", "AbortError");
    };
    const later = async () => { askedAfter += 1; return { payload: { eventOrders: [] } }; };
    await assert.rejects(
        consequences({ analyze: { units: cancelled, territory: null, structures: later }, signal: controller.signal }),
        { name: "AbortError" },
    );
    assert.equal(askedAfter, 0);
});

test("the territory changes are resolved against the map after the territory check", async () => {
    let resolved = null;
    let asked = 0;
    await consequences({
        analyze: { units: null, territory: async () => { asked += 1; return { payload: { eventOrders: [] } }; }, structures: null },
        resolveControl: async (containers) => { resolved = containers; },
        events: [{ ...headquarters, title: "Burkinabe Forces Capture Djibo", description: "Troops seize and occupy Djibo after a battle.", warId: "war-sahel" }],
    });
    assert.equal(asked, 1);
    assert.equal(resolved?.length, 1);
    assert.equal(resolved[0].path, "$.events[0].impacts");
});

// Seen in the same game: the player ordered things raised and built, and the
// events that answered the orders were worded so the Directors' text checks
// missed them. An event that cites a queued order's id goes to the Directors
// whatever its wording, and whatever the order's: which Director an order was
// for used to be read from its English words, and an order in any other
// language marked nothing.
test("an event that cites a queued order is one the Directors read, in any language", () => {
    const vague = { title: "Burkina Faso Expands Its Northern Presence", description: "Work continues in the north.", impacts: { actionIds: ["a-1"] } };
    assert.equal(eventNeedsNativeUnitDirector(vague), false);
    assert.equal(eventNeedsStructureDirector(vague), false);
    const english = markOrderedEvents([vague], [{ id: "a-1", text: "Build a fortified forward operating base at Djibo and raise a battalion to hold it." }]);
    const french = markOrderedEvents([vague], [{ id: "a-1", text: "Construire une base avancée fortifiée à Djibo et lever un bataillon pour la tenir." }]);
    assert.deepEqual(french, english);
    for (const [marked] of [english, french]) {
        assert.equal(eventNeedsNativeUnitDirector(marked), true);
        assert.equal(eventNeedsStructureDirector(marked), true);
    }
});

test("an event citing no queued order is untouched, and so is one citing an id that is not in the queue", () => {
    const answered = { title: "Envoys Meet in Lomé", impacts: { actionIds: ["a-3"] } };
    const stale = { title: "Talks Resume", impacts: { actionIds: ["gone"] } };
    const other = { title: "Rains Flood Niamey", impacts: {} };
    const [marked, keptStale, keptOther] = markOrderedEvents([answered, stale, other], [{ id: "a-3", text: "Send envoys to Lomé to discuss sanctions." }]);
    assert.deepEqual(marked.ordered, { forces: true, build: true });
    assert.equal(keptStale, stale);
    assert.equal(keptOther, other);
});

// Seen in a live check (2026-09-29): a Scene whose beats built a headquarters
// and raised a battalion was summed up as "Establishment of the Alliance of
// Sahel States Unified Military Command", and no Director read it. A Scene's
// beats are the player's choices, so they mark its outcome as an order does,
// whatever the choices say and in whatever language.
test("a Scene outcome is one the Directors read, however it and its choices are worded", () => {
    const outcome = { title: "Establishment of the Alliance of Sahel States Unified Military Command", description: "The command is established.", impacts: {} };
    assert.equal(eventNeedsNativeUnitDirector(outcome), false);
    assert.equal(eventNeedsStructureDirector(outcome), false);
    const english = markSceneOutcome(outcome, [{ choice: "Push for a shared mining fund", summary: "Ministers agree to study a fund." }]);
    const french = markSceneOutcome(outcome, [{ choice: "Proposer un fonds minier commun", summary: "Les ministres acceptent d'étudier un fonds." }]);
    assert.deepEqual(french, english);
    assert.equal(eventNeedsNativeUnitDirector(english), true);
    assert.equal(eventNeedsStructureDirector(english), true);
    // A Scene with no beat played has no choice of the player's in it.
    assert.deepEqual(markSceneOutcome(outcome, []), outcome);
    assert.equal(markSceneOutcome(null, [{ choice: "x" }]), null);
});

test("a Director whose answer is unavailable (a failed review) changes nothing", async () => {
    const unavailable = answer({ eventOrders: [] });
    const { events } = await consequences({ analyze: { units: unavailable, territory: null, structures: unavailable } });
    assert.deepEqual(events, [headquartersAsWritten]);
});

test("an event that builds, raises and takes nothing is never asked about", async () => {
    let asked = 0;
    const counting = async () => { asked += 1; return { payload: { eventOrders: [] } }; };
    await consequences({
        analyze: { units: counting, territory: counting, structures: counting },
        events: [{ title: "Envoys Meet in Lomé", description: "Talks on sanctions relief continue.", date: "2026-01-09", impacts: {} }],
    });
    assert.equal(asked, 0);
});

// A Scene's outcome may hand land over (its summary's regionTransfers). A
// transfer is what its op says it is, whatever the event's words: occupation is
// a control op, which the territory Director marks. An English reader once
// turned a transfer into occupation beside capture words, and never beside
// French ones.
test("land handed over is a transfer, in English and French alike, whatever the words tell of", async () => {
    const transfer = { regionId: "Djibo", fromCode: "Mali", toCode: "Burkina Faso", basis: "treaty" };
    const territory = answer({ eventOrders: [] });
    for (const [title, description] of [
        ["Mali Cedes Djibo to Burkina Faso by Treaty", "A treaty signed in Bamako cedes the Djibo district to Burkina Faso."],
        ["Burkinabe Forces Storm Djibo", "After a battle, Burkinabe troops capture and occupy Djibo."],
        ["Les forces burkinabè prennent Djibo", "Après une bataille, les troupes burkinabè prennent et occupent Djibo."],
    ]) {
        const [written] = (await consequences({
            analyze: { units: null, territory, structures: null },
            events: [{ title, description, date: "2026-01-09", impacts: { regionTransfers: [transfer] } }],
        })).events;
        assert.deepEqual(written.impacts.regionTransfers, [transfer], title);
        assert.equal(written.impacts.regionControlOps?.length ?? 0, 0, title);
    }
});
