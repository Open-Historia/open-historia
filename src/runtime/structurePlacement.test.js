/*! Open Historia — settling an approximately placed structure: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/structurePlacement.test.js
//
// A structure whose town the map does not know gets an approximate placement
// and is marked approximate (AI/placement.js). The player settles
// one of their own, or one of their puppets': Accept keeps it where it is, Move
// puts it where they click. Either way the mark goes, and nothing is ordered.

import test from "node:test";
import assert from "node:assert/strict";

import { applyMarkerOps } from "./gameState.js";
import { acceptStructure, approximateMark, canSettleStructure, moveStructure } from "./structurePlacement.js";

const MARK = { asked: "Djibo, Burkina Faso", country: "Burkina Faso", near: "Ouagadougou" };
const base = {
    id: "structure-1", name: "Djibo Forward Operating Base", kind: "military base",
    ownerCode: "Burkina Faso", lng: -1.2, lat: 12.5, approximate: MARK,
};

test("a structure built approximately keeps its mark in the world", () => {
    const [marker] = applyMarkerOps([], [{ op: "build", marker: base }]);
    assert.deepEqual(marker.approximate, MARK);
});

test("a structure built exactly carries no mark", () => {
    const [marker] = applyMarkerOps([], [{ op: "build", marker: { ...base, approximate: undefined } }]);
    assert.equal(marker.approximate, undefined);
});

test("the popup is given the mark to word its note from, and nothing for an exact structure", () => {
    assert.deepEqual(approximateMark(base), MARK);
    assert.equal(approximateMark({ ...base, approximate: undefined }), null);
    assert.equal(approximateMark({ ...base, approximate: { asked: "", country: "Burkina Faso" } }), null);
});

test("accepting keeps it where it is and clears the mark", () => {
    const [marker] = acceptStructure([base], "structure-1");
    assert.equal(marker.approximate, undefined);
    assert.deepEqual([marker.lng, marker.lat], [-1.2, 12.5]);
});

test("moving puts it where the player clicked, sea included, and clears the mark", () => {
    const [marker] = moveStructure([base], "structure-1", { lng: -1.53, lat: 14.1 });
    assert.deepEqual([marker.lng, marker.lat], [-1.53, 14.1]);
    assert.equal(marker.approximate, undefined);
    const [offshore] = moveStructure([base], "structure-1", { lng: 43.3, lat: 12.6 });
    assert.deepEqual([offshore.lng, offshore.lat], [43.3, 12.6]);
});

test("settling a structure that was never approximate changes nothing about it", () => {
    const exact = { ...base, approximate: undefined };
    assert.equal(acceptStructure([exact], "structure-1")[0], exact);
    const [moved] = moveStructure([exact], "structure-1", { lng: 1, lat: 2 });
    assert.equal(moved.approximate, undefined);
});

test("settling leaves every other structure, and a nonsense point, alone", () => {
    const other = { ...base, id: "structure-2", name: "Dori Depot" };
    const settled = acceptStructure([base, other], "structure-1");
    assert.deepEqual(settled[1], other);
    assert.deepEqual(moveStructure([base], "structure-1", { lng: Number.NaN, lat: 12 }), [base]);
    assert.deepEqual(moveStructure([base], "structure-1", { lng: 200, lat: 12 }), [base]);
});

test("the player settles their own approximate structures and their puppets', no one else's", () => {
    const world = { puppets: [{ id: "p-1", overlord: "Burkina Faso", puppet: "Mali", status: "active" }] };
    assert.equal(canSettleStructure(base, { playerCountry: "Burkina Faso", world }), true);
    assert.equal(canSettleStructure({ ...base, ownerCode: "Mali" }, { playerCountry: "Burkina Faso", world }), true);
    assert.equal(canSettleStructure({ ...base, ownerCode: "Russia" }, { playerCountry: "Burkina Faso", world }), false);
    assert.equal(canSettleStructure({ ...base, approximate: undefined }, { playerCountry: "Burkina Faso", world }), false);
});
