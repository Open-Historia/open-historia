/*! Open Historia — GM Console preview: every operation © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The GM Console promises the player can inspect every canonical operation a
// transaction carries before Apply. Its count chips and its "Exact canonical
// changes" list are built here from the impact families the event normalizer
// knows (gameState.js EVENT_IMPACT_KEYS): a family with a section of its own
// is shown there, and any other — one added after this was written — is shown
// under "Other operations" rather than applied unseen.

import { EVENT_IMPACT_KEYS } from "../../runtime/gameState.js";

// The families cheats.jsx gives a section of their own.
export const GM_PREVIEW_SECTIONED_IMPACTS = Object.freeze([
    "regionTransfers",
    "regionClaims",
    "regionControlOps",
    "polityChanges",
    "politicalActorOps",
    "unitOps",
    "markerOps",
    "createdChats",
    "groupOps",
    "institutionLifecycleOps",
]);

// Names the planned actions an event resolves; not an operation on the world.
const NOT_OPERATIONS = new Set(["actionIds"]);

// Every operation of one family across the transaction's events, each tagged
// with the event it belongs to.
export const collectImpactOps = (events, field) => (Array.isArray(events) ? events : []).flatMap((event, eventIndex) =>
    (Array.isArray(event?.impacts?.[field]) ? event.impacts[field] : []).map((op, opIndex) => ({
        ...op,
        _eventIndex: eventIndex,
        _eventTitle: event?.title || `Event ${eventIndex}`,
        _opIndex: opIndex,
    })));

// The families with operations in this transaction that have no section.
export const otherImpactFamilies = (events) => EVENT_IMPACT_KEYS
    .filter((field) => !GM_PREVIEW_SECTIONED_IMPACTS.includes(field) && !NOT_OPERATIONS.has(field))
    .map((field) => ({ field, ops: collectImpactOps(events, field) }))
    .filter((family) => family.ops.length > 0);

// The count chips.
export const countImpactOps = (events) => {
    const count = (field) => collectImpactOps(events, field).length;
    return {
        territory: count("regionTransfers") + count("regionClaims") + count("regionControlOps"),
        polities: count("polityChanges"),
        politics: count("politicalActorOps"),
        units: count("unitOps"),
        markers: count("markerOps"),
        chats: count("createdChats"),
        groups: count("groupOps"),
        institutions: count("institutionLifecycleOps"),
        other: otherImpactFamilies(events).reduce((sum, family) => sum + family.ops.length, 0),
    };
};
