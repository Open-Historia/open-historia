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
import { readWorldState, writeWorldState } from "./gameState.js";

const text = (value) => String(value ?? "").trim();
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase() && text(a) !== "";

// The approximate mark the popup words its note from (Selection/Features.jsx,
// where the sentences live so they translate whole), or null for a structure
// that was placed exactly.
export const approximateMark = (marker) => {
    const mark = marker?.approximate;
    return mark?.asked && mark?.country ? mark : null;
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

// A point off the earth, or no point at all, changes nothing.
export const moveStructure = (markers, id, { lng, lat } = {}) => {
    const x = Number(lng); const y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90) return markers;
    return settle(markers, id, { lng: Number(x.toFixed(5)), lat: Number(y.toFixed(5)) });
};

// The popup's Accept (no point) and the map's Move (the clicked point), written
// straight into the world: a correction of the map, not an order.
export const saveSettledStructure = async (id, point = null) => {
    const world = await readWorldState({ force: true });
    const markers = point ? moveStructure(world.markers, id, point) : acceptStructure(world.markers, id);
    await writeWorldState({ ...world, markers });
};
