/*! Open Historia — settling an approximately placed structure © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
//
// A structure whose town the map does not know gets an approximate placement —
// near the capital of the country its event named, inside that country when it
// marks no capital, or in its owner's own land — and carries
// `approximate: { asked, country, near }` (AI/placement.js). Its popup says so.
// The player settles one of their own, or of their puppets': Accept keeps it where it stands, Move puts it where they
// click — at sea too, since an offshore platform or an island base is meant to
// be there. Either way the mark goes. Neither is an order: the structure simply
// stands there from then on, and that is what the AI sees next turn.
//
// Runs under bare node: the puppet ledger and the world store both do.

import { livePuppetsFor } from "./puppets.js";
import { mutateWorldState } from "./gameState.js";
import { inSharedGame, requestFromHost } from "../multiplayer/client/sharedGameBridge.js";

const text = (value) => String(value ?? "").trim();
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase() && text(a) !== "";

// The approximate mark the popup words its note from (Selection/Features.jsx,
// where the sentences live so they translate whole), or null for a structure
// that was placed exactly.
export const approximateMark = (marker) => {
    const mark = marker?.approximate;
    return (mark?.asked || mark?.unnamed === true) && mark?.country ? mark : null;
};

// Accept and Move are offered on the player's own approximate structures and on
// their puppets' — a puppet may have built it on the player's order. Everyone
// else's shows the note only: the player cannot know where that AI meant it.
export const canSettleStructure = (marker, { playerCountry = "", world = {} } = {}) => {
    if (!approximateMark(marker)) return false;
    if (same(marker.ownerCode, playerCountry)) return true;
    return livePuppetsFor(world, playerCountry)
        .some((row) => row.role === "overlord" && same(row.puppet, marker.ownerCode));
};

const settle = (markers, id, change) => {
    const list = Array.isArray(markers) ? markers : [];
    return list.map((marker) => {
        if (marker?.id !== id) return marker;
        // Accepting a structure that was placed exactly leaves it exactly as it is.
        if (!approximateMark(marker) && !Object.keys(change).length) return marker;
        const { approximate: _settled, ...rest } = marker;
        return { ...rest, ...change };
    });
};

export const acceptStructure = (markers, id) => settle(markers, id, {});

// How far out to sea a structure may be moved off its country's own land: an
// island base, a platform off its coast.
export const STRUCTURE_SEA_KM = 300;
const MOVE_REFUSED = Object.freeze({
  chart: "The map could not be read to see whose ground that is: try again.",
  ground: "A structure is moved onto its own country's land, or to the sea off it.",
});

// Where Move may put a structure in a shared game, held to the host's own map
// (runtime/warRoomChart.js chartOf): onto land its country holds (its
// ownerCode: a puppet's structure onto the puppet's), or out to sea within
// STRUCTURE_SEA_KM of that land. "" when it may, else why not, in words. Any
// point on Earth was taken, another player's capital included (the gap audit
// of 2026-11-18). Single player puts it where the player clicks, as it always has.
export const structureMoveRefusal = (marker, { lng, lat } = {}, { chart = null } = {}) => {
  if (!chart || typeof chart.holds !== "function") return MOVE_REFUSED.chart;
  const owner = text(marker?.ownerCode);
  const held = chart.holds(owner, Number(lng), Number(lat));
  if (held === true) return "";
  if (held === false) return MOVE_REFUSED.ground;
  const offShore = typeof chart.sea === "function" && chart.sea(Number(lng), Number(lat))
    && typeof chart.landNear === "function" && chart.landNear(owner, Number(lng), Number(lat), STRUCTURE_SEA_KM);
  return offShore ? "" : MOVE_REFUSED.ground;
};

// A point off the earth, or no point at all, changes nothing.
export const moveStructure = (markers, id, { lng, lat } = {}) => {
    const x = Number(lng); const y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90) return markers;
    return settle(markers, id, { lng: Number(x.toFixed(5)), lat: Number(y.toFixed(5)) });
};

// The popup's Accept (no point) and the map's Move (the clicked point), written
// straight into the world: a correction of the map, not an order. Through the
// write queue, on the world as it stands when the write's turn comes, so it
// cannot put back a world another writer has changed since.
//
// In a shared game the world is the host's: the page asks (request "settle"),
// the host checks the structure is the player's to settle and writes it, and
// the next view shows it. A refusal is thrown with the host's reason.
export const saveSettledStructure = async (id, point = null) => {
    if (inSharedGame()) {
        const answer = await requestFromHost("settle", {
            marker: String(id ?? ""),
            move: Boolean(point),
            lng: Number(point?.lng) || 0,
            lat: Number(point?.lat) || 0,
        });
        if (!answer.ok) throw new Error(answer.error || "The host did not settle the structure.");
        return;
    }
    await mutateWorldState((world) => {
        const markers = point ? moveStructure(world.markers, id, point) : acceptStructure(world.markers, id);
        return { ...world, markers };
    });
};
