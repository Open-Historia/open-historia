/*! Open Historia — the placement pass over a payload: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/placementPass.test.js
//
// placement.js says where a phrase is; the pass in gameplay.js (resolvePlacements)
// decides what a unit operation ends up with: the place it named, an
// approximate one, its owner's own land, the sea off a coast. gameplay.js
// cannot be imported without the whole app, so the pass is sliced out of it and
// run with its real helpers and a small map in place of the app's (as
// server/desktopPortProbe.test.js does with the desktop shell).
//
// What started this: a player's log (beta 0.0.66, 2026-10-05, played in
// Russian) with "unitOps[1] dropped — spawn has unusable coordinates
// (lng=undefined, lat=undefined)" eighteen times over, for a squadron of the
// Black Sea Fleet. The squadron had been given the inland fallback an army
// gets, the fleet rule found no sea within 400 km of it, and it deleted the
// coordinates: a formation the event raised and the map never showed.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
    bboxOfGeometry,
    describeApproximatePlacement,
    hashText,
    homeWaters,
    nearestSea,
    pointInGeometry,
    resolvePlacement,
    resolveRegionPlacement,
} from "./placement.js";
import { FOOTPRINT_KM, obstaclesOf, spaceOut } from "../../runtime/featureSpacing.js";
import { createApplicationReceipt, noteReceipt } from "../../runtime/applicationReceipt.js";
import { placementNote } from "../../runtime/receiptPlayerNotes.js";
import { normalizeEvents } from "../../runtime/gameState.js";
import { seaShareOf } from "../../runtime/unitMotion.js";
import { findUnitByRef, readNameRef } from "./nameRefs.js";

const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const start = source.indexOf("const LAND_UNIT_TYPES = new Set(");
const end = source.indexOf("// A garrison or base on another power's land is deployed by");
assert.ok(start !== -1 && end > start, "could not find the placement pass in gameplay.js");

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();
const fold = (value) => asText(value).toLowerCase();

// The pass, over `gazetteer` in place of the one gameplay.js builds from the map.
const placementPass = (gazetteer) => new Function(
    "normalizeArray", "normalizeString", "lazyLookupContext", "buildPlacementGazetteer", "obstaclesOf", "spaceOut", "FOOTPRINT_KM",
    "resolvePlacement", "resolveRegionPlacement", "describeApproximatePlacement", "nearestSea", "homeWaters", "placementHash",
    "noteReceipt", "placementNote", "noteUndeployedPosts", "logDebugEvent", "findUnitByRef", "readNameRef", "seaShareOf",
    `${source.slice(start, end)}\nreturn resolvePlacements;`,
)(
    asArray, asText, () => async () => ({}), () => gazetteer, obstaclesOf, spaceOut, FOOTPRINT_KM,
    resolvePlacement, resolveRegionPlacement, describeApproximatePlacement, nearestSea, homeWaters, hashText,
    noteReceipt, placementNote, () => {}, () => {}, findUnitByRef, readNameRef, seaShareOf,
);

// What gameplay.js's gazetteer offers the pass, over a list of regions.
const gazetteerOf = (regions, { capitals = {} } = {}) => {
    const rows = regions.map((region) => ({ ...region, box: bboxOfGeometry(region.geometry) }));
    const regionAt = ([lng, lat]) => rows.find((row) => lng >= row.box[0] && lng <= row.box[2] && lat >= row.box[1] && lat <= row.box[3]
        && pointInGeometry([lng, lat], row.geometry)) ?? null;
    const ownedBy = (name) => rows.filter((row) => fold(row.owner) === fold(name));
    return {
        regionAt,
        find: (name) => {
            const owned = ownedBy(name);
            if (owned.length) return { kind: "polity", name: owned[0].owner, regions: owned };
            const region = rows.find((row) => fold(row.name) === fold(name) || fold(row.id) === fold(name));
            return region ? { kind: "region", name: region.name, region } : null;
        },
        findRegionId: (id) => rows.find((row) => row.id === asText(id)) ?? null,
        suggest: () => [],
        sharedName: () => [],
        nearestLand: () => null,
        seas: [],
        holdsLand: (name) => ownedBy(name).length > 0,
        capitalOf: (name) => capitals[fold(name)] ?? null,
        placesNamedIn: () => [],
        samePolity: (a, b) => Boolean(fold(a)) && fold(a) === fold(b),
        // No list of the world's towns here: nothing is asked of one, and none arrives.
        worldCities: () => [],
        worldCitiesArrived: async () => false,
    };
};

//        0   10   20   30
//  30    +----+----+----+
//        | NW | N  | NE |
//  20    +----+----+----+
//        | W  | C  | E  |          (sea everywhere else; a box is some 1,100 km across)
//  10    +----+----+----+
//        | SW | S  | SE |
//   0    +----+----+----+
//
// Longland holds C and E: its capital stands in the middle of C, more than
// 400 km from any sea, and its only shore is E's east side. Inland holds
// nothing but its own box when C is given to it. Rimland holds the rest.
const box = (west, south) => ({ type: "Polygon", coordinates: [[[west, south], [west + 10, south], [west + 10, south + 10], [west, south + 10], [west, south]]] });
const continent = (owners = {}) => gazetteerOf([
    ["nw", "North-West", 0, 20], ["n", "North", 10, 20], ["ne", "North-East", 20, 20],
    ["w", "West", 0, 10], ["c", "Centre", 10, 10], ["e", "East", 20, 10],
    ["sw", "South-West", 0, 0], ["s", "South", 10, 0], ["se", "South-East", 20, 0],
].map(([id, name, west, south]) => ({ id, name, owner: owners[id] ?? "Rimland", geometry: box(west, south) })), {
    capitals: { longland: { name: "Midburg", point: [15, 15] } },
});
const LONGLAND = { c: "Longland", e: "Longland" };

const spawn = (unit) => ({ op: "spawn", unit: { id: "fleet-1", name: "1st Squadron", type: "naval", ownerCode: "Longland", strength: 100, ...unit } });
const place = async (gazetteer, unitOps, { world = {}, event = { title: "The squadron is formed", description: "It is ordered to sea." } } = {}) => {
    const receipt = createApplicationReceipt();
    await placementPass(gazetteer)([{ event, impacts: { unitOps }, path: "$.events[0]" }], world, { receipt });
    return { receipt, notes: receipt.notes.map((note) => `${note.kind}: ${note.text}`) };
};
const atSea = (gazetteer, unit) => Number.isFinite(unit.lng) && Number.isFinite(unit.lat) && gazetteer.regionAt([unit.lng, unit.lat]) === null;

test("a new fleet given no place is put to sea off its owner's own coast, not dropped", async () => {
    const gazetteer = continent(LONGLAND);
    const op = spawn();
    const { notes } = await place(gazetteer, [op]);
    assert.ok(atSea(gazetteer, op.unit), `not at sea: ${op.unit.lng},${op.unit.lat}`);
    assert.ok(op.unit.lng > 30, "east of East, the only shore Longland has");
    assert.equal(op.unit.regionId, "", "a point at sea is in no region");
    assert.equal(notes.length, 2);
    assert.match(notes[0], /^adjusted: Event "The squadron is formed": 1st Squadron came with no place and no coordinates\. It was raised in Centre, inside Longland's own territory/);
    assert.match(notes[1], /^adjusted: Event "The squadron is formed": 1st Squadron was placed inland, too far from any sea for a fleet, and was put to sea off East, on Longland's own coast, instead\./);
});

test("a new fleet whose place the map cannot read goes the same way", async () => {
    const gazetteer = continent(LONGLAND);
    // The words of the squadron in the log. Nothing on this map is called that.
    const op = spawn({ at: "центральная часть Чёрного моря" });
    const { notes } = await place(gazetteer, [op]);
    assert.ok(atSea(gazetteer, op.unit), `not at sea: ${op.unit.lng},${op.unit.lat}`);
    assert.ok(op.unit.lng > 30);
    assert.equal(op.unit.at, undefined, "the phrase is spent");
    assert.match(notes[0], /could not be placed at "центральная часть Чёрного моря".*It was placed near Midburg, in Longland instead/);
    assert.match(notes[1], /was put to sea off East, on Longland's own coast, instead/);
});

test("the fleet reaches the map: the normalizer keeps it, and has nothing to report", async (t) => {
    const gazetteer = continent(LONGLAND);
    const op = spawn();
    await place(gazetteer, [op]);
    const warn = t.mock.method(console, "warn", () => {});
    const [event] = normalizeEvents([{ title: "The squadron is formed", impacts: { unitOps: [op] } }]);
    assert.equal(event.impacts.unitOps.length, 1);
    assert.deepEqual([event.impacts.unitOps[0].unit.lng, event.impacts.unitOps[0].unit.lat], [op.unit.lng, op.unit.lat]);
    assert.equal(warn.mock.callCount(), 0);
});

test("a fleet on land near a shore still goes to the sea off that shore", async () => {
    const gazetteer = continent(LONGLAND);
    const op = spawn({ at: "[29, 15]" });
    const { notes } = await place(gazetteer, [op]);
    assert.ok(atSea(gazetteer, op.unit));
    assert.deepEqual(notes.map((note) => note.replace(/^.*1st Squadron /, "")), ['was placed on land and was moved to the sea off its coast. Place fleets with "off <port>" or the name of a sea.']);
});

test("a fleet SENT inland is not moved: only a new one is given its owner's waters", async () => {
    const gazetteer = continent(LONGLAND);
    const world = { units: [{ id: "fleet-1", name: "1st Squadron", type: "naval", ownerCode: "Longland", lng: 31, lat: 15 }] };
    const op = { op: "move", unitId: "fleet-1", at: "Centre" };
    const { notes } = await place(gazetteer, [op], { world });
    assert.equal(op.toLng, undefined);
    assert.equal(op.toLat, undefined);
    assert.deepEqual(notes, ['dropped: Event "The squadron is formed": 1st Squadron was sent inland, too far from any sea for a fleet, and was not moved. Place fleets with "off <port>" or the name of a sea.']);
});

test("a new fleet put inland in another power's country is not sent home to a far coast", async () => {
    const gazetteer = continent(LONGLAND);
    // Rimland's land, the middle of it more than 400 km from any sea.
    const op = spawn({ at: "North-West" });
    const { notes } = await place(gazetteer, [op]);
    assert.equal(op.unit.lng, undefined);
    assert.equal(op.unit.lat, undefined);
    assert.deepEqual(notes, ['dropped: Event "The squadron is formed": 1st Squadron was placed inland, too far from any sea for a fleet, and was left off the map. Place fleets with "off <port>" or the name of a sea.']);
});

test("a new fleet whose owner holds no coast is left off the map, and the normalizer says so once", async (t) => {
    const gazetteer = continent({ c: "Inland" });
    const op = spawn({ ownerCode: "Inland" });
    const { notes } = await place(gazetteer, [op]);
    assert.equal(op.unit.lng, undefined);
    assert.equal(op.unit.lat, undefined);
    assert.match(notes.at(-1), /^dropped: .*1st Squadron was placed inland, too far from any sea for a fleet, and was left off the map\./);

    // The validators read the same raw events again and again on the way to a
    // turn: eighteen passes met this op in the log, and each said so.
    const warn = t.mock.method(console, "warn", () => {});
    const raw = [{ title: "The squadron is formed", impacts: { unitOps: [op] } }];
    for (let pass = 0; pass < 18; pass += 1) assert.equal(normalizeEvents(raw)[0].impacts.unitOps.length, 0);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /unitOps\[0\] dropped — spawn has unusable coordinates \(lng=undefined, lat=undefined\)/);
    // The same mistake on a later turn's event is another drop, and is said again.
    normalizeEvents([{ title: "The squadron is formed", date: "2014-06-01", impacts: { unitOps: [JSON.parse(JSON.stringify(op))] } }]);
    assert.equal(warn.mock.callCount(), 2);
});

test("an army nothing places is still raised on its owner's own land", async () => {
    const gazetteer = continent(LONGLAND);
    const op = spawn({ id: "army-1", name: "1st Army", type: "infantry" });
    await place(gazetteer, [op]);
    assert.equal(gazetteer.regionAt([op.unit.lng, op.unit.lat])?.owner, "Longland");
});

// The squadron itself, on the map it was raised on: Modern Day's own, where the
// player's game calls Russia the Russian Federation and its capital is Moskva.
const MODERN_DAY = JSON.parse(readFileSync(new URL("../../../server/seed/default/regions.geojson", import.meta.url), "utf8"))
    .features.filter((feature) => feature?.geometry)
    .map((feature) => ({
        id: String(feature.properties.id),
        name: feature.properties.name,
        owner: feature.properties.owner === "Russia" ? "Russian Federation" : feature.properties.owner,
        geometry: feature.geometry,
    }));

test("the Black Sea Fleet squadron from the log is put to sea off Russia's coast", async (t) => {
    const gazetteer = gazetteerOf(MODERN_DAY, { capitals: { "russian federation": { name: "Moskva", point: [37.596, 55.779] } } });
    // The operation as the log printed it: what was left of it once its place
    // and its coordinates had been taken away.
    const op = {
        op: "spawn",
        unit: {
            composition: "крейсер «Москва», БПК «Керчь», СКР «Сметливый», БДК «Цезарь Куников», БДК «Ямал»",
            id: "ru-bsf-squadron",
            name: "Отряд кораблей Черноморского флота",
            note: "После сентябрьского учения держит постоянное присутствие в центральной части Чёрного моря.",
            ownerCode: "Russian Federation",
            posture: "patrol",
            strength: 100,
            type: "naval",
            regionId: "",
        },
    };
    const { notes } = await place(gazetteer, [op], { event: { title: "Черноморский флот выходит в море", description: "Отряд кораблей держит присутствие в Чёрном море." } });
    assert.ok(atSea(gazetteer, op.unit), `not at sea: ${op.unit.lng},${op.unit.lat}`);
    assert.match(notes.at(-1), /Отряд кораблей Черноморского флота was placed inland, too far from any sea for a fleet, and was put to sea off .+, on Russian Federation's own coast, instead\./);

    const warn = t.mock.method(console, "warn", () => {});
    const [event] = normalizeEvents([{ title: "Черноморский флот выходит в море", impacts: { unitOps: [op] } }]);
    assert.equal(event.impacts.unitOps.length, 1, "the formation the event raised is on the map");
    assert.equal(event.impacts.unitOps[0].unit.type, "naval");
    assert.equal(warn.mock.callCount(), 0);
});
