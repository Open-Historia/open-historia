/*! Open Historia — the map consequences of a batch of events © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
//
// A jump's events and a Scene's outcome reach the map the same way: the unit
// Director raises, moves and wears down units; the territory Director marks who
// holds the ground, and those marks are resolved against the map; the structure
// Director builds Structures. Each Director's accepted changes ride on the events
// that caused them, and are applied with every other impact when the turn or the
// Scene is written.
//
// Seen in a live game (2026-09-27): a Scene established a unified military
// command's headquarters in Ouagadougou and nothing appeared on the map, because
// a Scene outcome never reached a Director; only a jump's events did. Both now
// come through here, so the two cannot drift apart again.
//
// The caller supplies how each Director is answered (`analyze`), usually by one
// turn review request (gameplay.js runTurnReview), and how territory marks are
// resolved (`resolveControl`). Each analyser is called with the Director's input
// and the events as they stand at that point, since an answer is placed against
// those events. A Director with no analyser is not run: it is not among the
// checks the caller asked for (the settings that switched each one off are
// gone). A Director that fails costs only its own changes; the events always
// stand as written. The player's Cancel is not a failure: it ends the turn.

import { directGeneratedUnitOps, orderRaisesForces } from "./nativeUnitDirector.js";
import { directGeneratedTerritoryOps } from "./nativeTerritoryDirector.js";
import { directGeneratedStructureOps, orderBuildsStructure } from "./nativeStructureDirector.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const text = (value) => String(value ?? "").trim();

// An event that answers the player's order to raise forces or build something is
// the Directors' to read, however it is worded. Seen in the same game: the player
// ordered things raised and built, and the events that answered were worded so the
// Directors' text checks passed them by. The hint (`ordered`) lives only while the
// turn is being made; applyMapConsequences takes it off again.
export const markOrderedEvents = (events, actions) => {
    const byId = new Map(asArray(actions).filter((action) => text(action?.id)).map((action) => [text(action.id), action]));
    return asArray(events).map((event) => {
        const orders = asArray(event?.impacts?.actionIds).map((id) => byId.get(text(id))).filter(Boolean);
        if (!orders.length) return event;
        return markedBy(event, orders.map((action) => `${text(action.title)} ${text(action.text)}`));
    });
};

// A Scene's beats are the player's choices and what came of them: they mark the
// Scene outcome as an order marks the event that answers it, because the model
// that sums the Scene up may leave out the headquarters or the battalion.
export const markSceneOutcome = (outcome, beats) => (outcome
    ? markedBy(outcome, asArray(beats).map((beat) => `${text(beat?.choice)} ${text(beat?.summary)}`))
    : outcome);

const markedBy = (event, words) => {
    const forces = words.some(orderRaisesForces);
    const build = words.some(orderBuildsStructure);
    return forces || build ? { ...event, ordered: { forces, build } } : event;
};

const withoutHints = (events) => asArray(events).map((event) => {
    if (!event || typeof event !== "object" || !("ordered" in event)) return event;
    const { ordered: _hint, ...rest } = event;
    return rest;
});

// -> { events, structureLinks }
export const applyMapConsequences = async ({
    events = [],
    world = {},
    game = {},
    playerCountry = "",
    analyze = {},
    findPlaces = null,
    resolveControl = async () => {},
    signal = null,
} = {}) => {
    let current = asArray(events);
    // A cancelled turn stops; any other failure costs only that Director's changes.
    // Each Director is handed the signal as well: it catches every failure of its
    // own analysis and carries on with the events as written, and without the
    // signal it would take the player's Cancel for one of those.
    const failed = (message, error) => {
        if (signal?.aborted) throw error;
        console.warn(message, error);
    };
    const asking = (analyser) => (input) => analyser(input, current);

    if (typeof analyze.units === "function") {
        try {
            current = await directGeneratedUnitOps({ events: current, game, world, signal, analyzeBatch: asking(analyze.units) });
        } catch (error) {
            failed("[OH unit director] pass failed; the events keep the unit changes they had.", error);
        }
    }

    // Occupation only: the territory Director never invents a legal transfer. Land
    // a Scene trades by agreement arrives on the Scene outcome itself.
    if (typeof analyze.territory === "function") {
        try {
            const marked = await directGeneratedTerritoryOps({ events: current, world, findPlaces, signal, analyzeBatch: asking(analyze.territory) });
            await resolveControl(marked.map((event, index) => ({ event, impacts: event?.impacts, path: `$.events[${index}].impacts` })));
            current = marked;
        } catch (error) {
            failed("[OH territory director] pass failed; the events keep the territory changes they had.", error);
        }
    }

    let structureLinks = [];
    if (typeof analyze.structures === "function") {
        try {
            const built = await directGeneratedStructureOps({ events: current, world, playerCountry, signal, analyzeBatch: asking(analyze.structures) });
            current = built.events;
            structureLinks = asArray(built.links);
        } catch (error) {
            failed("[OH structure director] pass failed; the events keep the structures they had.", error);
        }
    }

    return { events: withoutHints(current), structureLinks };
};
