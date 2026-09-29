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

const headquarters = {
    title: "Establishment of Alliance of Sahel States Unified Military Command",
    description: "President Traore finalized the establishment of the Unified Military Command headquarters in Ouagadougou and raised a new joint rapid-reaction battalion to guard it.",
    date: "2026-01-08",
    kind: "interactive",
    impacts: {},
};
const world = { units: [], markers: [], projects: [] };
const answer = (payload) => async () => ({ payload });
const structureAnswer = answer({
    eventOrders: [{ eventIndex: 0, structures: [{ name: "AES Unified Command Headquarters", kind: "military headquarters", ownerCode: "Burkina Faso", lng: -1.53, lat: 12.37 }] }],
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
    assert.deepEqual(events, [headquarters]);
    assert.deepEqual(structureLinks, []);
});

test("a check that fails costs only its own changes, and the event stands as written", async () => {
    const failing = async () => { throw new Error("the model is busy"); };
    const { events } = await consequences({ analyze: { units: failing, territory: null, structures: structureAnswer } });
    assert.equal(events[0].title, headquarters.title);
    assert.equal(events[0].impacts.unitOps, undefined);
    assert.equal(events[0].impacts.markerOps?.length, 1, "the structure still lands");
});

test("the territory changes are resolved against the map after the territory check", async () => {
    let resolved = null;
    await consequences({
        analyze: { units: null, territory: answer({ eventOrders: [] }), structures: null },
        resolveControl: async (containers) => { resolved = containers; },
        events: [{ ...headquarters, title: "Burkinabe Forces Capture Djibo", description: "Troops seize and occupy Djibo after a battle." }],
    });
    assert.equal(resolved?.length, 1);
    assert.equal(resolved[0].path, "$.events[0].impacts");
});

// Seen in the same game: the player ordered things raised and built, and the
// events that answered the orders were worded so the Directors' text checks
// missed them. An order that says raise, build or establish sends its outcome
// to the Directors whatever the event's wording.
test("an event answering the player's order to raise or build is one the Directors read", () => {
    const vague = { title: "Burkina Faso Expands Its Northern Presence", description: "Work continues in the north.", impacts: { actionIds: ["a-1", "a-2"] } };
    assert.equal(eventNeedsNativeUnitDirector(vague), false);
    assert.equal(eventNeedsStructureDirector(vague), false);
    const [marked] = markOrderedEvents([vague], [
        { id: "a-1", text: "Raise a new VDP rapid-reaction battalion and deploy it to Dori." },
        { id: "a-2", text: "Build a fortified forward operating base at Djibo." },
    ]);
    assert.equal(eventNeedsNativeUnitDirector(marked), true);
    assert.equal(eventNeedsStructureDirector(marked), true);
});

// Seen in a live check (2026-09-29): a Scene whose beats built a headquarters
// and raised a battalion was summed up as "Establishment of the Alliance of
// Sahel States Unified Military Command", and no Director read it. A Scene's
// beats are the player's choices, so they mark its outcome as an order does.
test("a Scene outcome whose beats raise or build is one the Directors read, however it is summed up", () => {
    const outcome = { title: "Establishment of the Alliance of Sahel States Unified Military Command", description: "The command is established.", impacts: {} };
    assert.equal(eventNeedsNativeUnitDirector(outcome), false);
    assert.equal(eventNeedsStructureDirector(outcome), false);
    const marked = markSceneOutcome(outcome, [
        { choice: "Propose a unified command headquartered in Ouagadougou", summary: "Mali and Niger agree." },
        { choice: "Order construction to begin and raise a guard battalion", summary: "Construction of the headquarters compound begins, and a new rapid-reaction battalion is raised to guard it." },
    ]);
    assert.equal(eventNeedsNativeUnitDirector(marked), true);
    assert.equal(eventNeedsStructureDirector(marked), true);
    const talks = markSceneOutcome(outcome, [{ choice: "Push for a shared mining fund", summary: "Ministers agree to study a fund." }]);
    assert.deepEqual(talks, outcome);
});

test("an order that raises or builds nothing marks nothing, and unrelated events are untouched", () => {
    const answered = { title: "Envoys Meet in Lomé", impacts: { actionIds: ["a-3"] } };
    const other = { title: "Rains Flood Niamey", impacts: {} };
    const marked = markOrderedEvents([answered, other], [{ id: "a-3", text: "Send envoys to Lomé to discuss sanctions." }]);
    assert.deepEqual(marked, [answered, other]);
});

test("a Director whose answer is unavailable (a failed review) changes nothing", async () => {
    const unavailable = answer({ eventOrders: [] });
    const { events } = await consequences({ analyze: { units: unavailable, territory: null, structures: unavailable } });
    assert.deepEqual(events, [headquarters]);
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

// A Scene's outcome may hand land over (its summary's regionTransfers). A treaty
// is a transfer; a capture written as one is occupation, as it is after a jump.
test("land ceded by treaty stays a transfer; land seized in fighting becomes occupation", async () => {
    const transfer = { regionId: "Djibo", fromCode: "Mali", toCode: "Burkina Faso", basis: "treaty" };
    const territory = answer({ eventOrders: [] });
    const [ceded] = (await consequences({
        analyze: { units: null, territory, structures: null },
        events: [{ title: "Mali Cedes Djibo to Burkina Faso by Treaty", description: "A treaty signed in Bamako cedes the Djibo district to Burkina Faso.", date: "2026-01-09", impacts: { regionTransfers: [transfer] } }],
    })).events;
    assert.equal(ceded.impacts.regionTransfers?.length, 1);
    const [seized] = (await consequences({
        analyze: { units: null, territory, structures: null },
        events: [{ title: "Burkinabe Forces Storm Djibo", description: "After a battle, Burkinabe troops capture and occupy Djibo.", date: "2026-01-09", impacts: { regionTransfers: [transfer] } }],
    })).events;
    assert.equal(seized.impacts.regionTransfers?.length ?? 0, 0);
    assert.equal(seized.impacts.regionControlOps?.length, 1);
});
