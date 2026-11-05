/*! Open Historia — placement: a kind is a preference, and a new thing always lands: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/placementManila.test.js
//
// A player's log (beta 0.0.80, 2026-10-12) said two Philippine squadrons were
// "dropped — spawn has unusable coordinates (lng=undefined, lat=undefined)":
// a fleet at "off Manila, country: Philippines" and a fighter wing at "region:
// Manila, country: Philippines". On the built-in map both phrases place, and
// both units were on the map: the line came from the panel that shows a skip's
// events as they are written, which read the raw answer before anything had
// been placed (gameState.js awaitsPlacement). Looking for what could have
// dropped them found three things that were wrong on the way:
//
//   - a name said with a kind the map does not have it as was not looked up
//     as anything else ("sea: Manila", "city: Tablas");
//   - an address whose spot the map lacks went to the middle of its country
//     without a word ("Basa Air Base, Philippines");
//   - a place called after a town ("Manila Bay") was put by its owner's
//     capital, an ocean away, when its owner was another country.
//
// gameplay.js cannot be imported without the whole app, so the pass is sliced
// out of it and run with its real helpers, as placementPass.test.js does.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
    describeApproximatePlacement,
    describeOtherKind,
    distanceKm,
    hashText,
    homeWaters,
    nearestSea,
    pointInGeometry,
    regionWithinContainer,
    resolvePlacement,
    resolveRegionPlacement,
} from "./placement.js";
import { FOOTPRINT_KM, obstaclesOf, spaceOut } from "../../runtime/featureSpacing.js";
import { createApplicationReceipt, noteReceipt } from "../../runtime/applicationReceipt.js";
import { placementNote } from "../../runtime/receiptPlayerNotes.js";
import { normalizeEvents } from "../../runtime/gameState.js";
import { seaShareOf } from "../../runtime/unitMotion.js";
import { findUnitByRef, readNameRef, stripKindTags } from "./nameRefs.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();
const fold = (value) => asText(value).toLowerCase();
const box = (west, south, east, north) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });

// Manila stands on the west shore of its province, with the bay beyond it.
// Mindanao is the bulk of the country, so "the middle of the Philippines" is
// not by the capital and the two can be told apart.
const REGIONS = [
    { id: "ph-mnl", name: "Manila", owner: "Philippines", geometry: box(120.95, 14.3, 121.4, 14.8) },
    { id: "ph-tab", name: "Tablas", owner: "Philippines", geometry: box(121.9, 12.2, 122.2, 12.6) },
    { id: "ph-min", name: "Mindanao", owner: "Philippines", geometry: box(123, 6, 126.5, 9.5) },
    { id: "jp-tyo", name: "Tokyo", owner: "Japan", geometry: box(139, 35, 140.5, 36.2) },
    { id: "us-dc", name: "Washington", owner: "United States", geometry: box(-78, 38, -76.5, 40) },
    { id: "kz-ast", name: "Astana", owner: "Kazakhstan", geometry: box(60, 42, 80, 54) },
];
const CITIES = [
    { name: "Manila", owner: "Philippines", point: [120.98, 14.6] },
    { name: "Tokyo", owner: "Japan", point: [139.7, 35.7] },
    { name: "Washington D.C.", owner: "United States", point: [-77, 38.9] },
];
const CAPITALS = { philippines: CITIES[0], japan: CITIES[1], "united states": CITIES[2] };
const MANILA = CITIES[0].point;

// Answers the way gameplay.js's gazetteer does: a name asked for as one kind is
// that kind or nothing, and one given with a country is in that country.
const mapOf = () => {
    const regionAt = (point) => REGIONS.find((row) => pointInGeometry(point, row.geometry)) ?? null;
    const find = (name, { country = "", kind = "" } = {}) => {
        const key = fold(name);
        const within = (owner) => !country || fold(owner) === fold(country);
        const polity = () => {
            const held = REGIONS.filter((row) => fold(row.owner) === key);
            return held.length ? { kind: "polity", name: held[0].owner, regions: held } : null;
        };
        const city = () => {
            const hit = CITIES.find((row) => fold(row.name) === key && within(row.owner));
            return hit ? { kind: "city", name: hit.name, point: hit.point } : null;
        };
        const region = () => {
            const hit = REGIONS.find((row) => fold(row.name) === key && within(row.owner));
            return hit ? { kind: "region", name: hit.name, region: hit } : null;
        };
        if (kind === "country") return polity();
        if (kind === "city") return city();
        if (kind === "region") return region();
        if (kind) return null; // a sea, a unit, a structure: this map names none
        return polity() ?? city() ?? region();
    };
    return {
        find,
        regionAt,
        findRegionId: (id) => REGIONS.find((row) => row.id === asText(id)) ?? null,
        suggest: () => [],
        sharedName: () => [],
        nearestLand: () => null,
        seas: [],
        holdsLand: (name) => REGIONS.some((row) => fold(row.owner) === fold(name)),
        capitalOf: (name) => CAPITALS[fold(name)] ?? null,
        placesNamedIn: () => [],
        samePolity: (a, b) => Boolean(fold(a)) && fold(a) === fold(b),
        worldCities: () => [],
        worldCitiesArrived: async () => false,
    };
};

const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const start = source.indexOf("const LAND_UNIT_TYPES = new Set(");
const end = source.indexOf("// A garrison or base on another power's land is deployed by");
assert.ok(start !== -1 && end > start, "could not find the placement pass in gameplay.js");
const placementPass = (gazetteer) => new Function(
    "normalizeArray", "normalizeString", "lazyLookupContext", "buildPlacementGazetteer", "obstaclesOf", "spaceOut", "FOOTPRINT_KM",
    "resolvePlacement", "resolveRegionPlacement", "describeApproximatePlacement", "nearestSea", "homeWaters", "placementHash",
    "noteReceipt", "placementNote", "noteUndeployedPosts", "logDebugEvent", "findUnitByRef", "readNameRef", "seaShareOf",
    "regionWithinContainer", "describeOtherKind", "stripKindTags",
    `${source.slice(start, end)}\nreturn resolvePlacements;`,
)(
    asArray, asText, () => async () => ({}), () => gazetteer, obstaclesOf, spaceOut, FOOTPRINT_KM,
    resolvePlacement, resolveRegionPlacement, describeApproximatePlacement, nearestSea, homeWaters, hashText,
    noteReceipt, placementNote, () => {}, () => {}, findUnitByRef, readNameRef, seaShareOf,
    regionWithinContainer, describeOtherKind, stripKindTags,
);

const EVENT = { title: "The Philippines Responds", description: "Forces deploy after the attack of January 1." };
const spawnOf = (type, at, ownerCode = "Philippines", name = `Test ${type}`) => ({ op: "spawn", unit: { name, type, ownerCode, strength: 90, at, posture: "holding" } });
const run = async (impacts, { world = {} } = {}) => {
    const gazetteer = mapOf();
    const receipt = createApplicationReceipt();
    await placementPass(gazetteer)([{ event: EVENT, impacts, path: "$.events[0]" }], world, { receipt });
    return { gazetteer, notes: receipt.notes.map((note) => `${note.kind}: ${note.text}`) };
};
const raise = async (type, at, ownerCode) => {
    const op = spawnOf(type, at, ownerCode);
    const { gazetteer, notes } = await run({ unitOps: [op] });
    const { lng, lat } = op.unit;
    const placed = Number.isFinite(lng) && Number.isFinite(lat);
    return {
        unit: op.unit, notes, placed,
        region: placed ? gazetteer.regionAt([lng, lat]) : null,
        kmFromManila: placed ? distanceKm([lng, lat], MANILA) : Infinity,
    };
};

// --- the two the log named ---------------------------------------------------

test("the fleet of the log, off Manila, is at sea off Manila", async () => {
    const got = await raise("naval", "off Manila, country: Philippines");
    assert.ok(got.placed, "it has coordinates");
    assert.equal(got.region, null, "at sea");
    assert.ok(got.kmFromManila < 80, `${got.kmFromManila} km from Manila`);
    assert.equal(got.unit.at, undefined, "a placed op no longer carries its phrase");
    assert.deepEqual(got.notes, []);
});

test("the wing of the log, in the region Manila, is in Manila", async () => {
    const got = await raise("air", "region: Manila, country: Philippines");
    assert.equal(got.region?.id, "ph-mnl");
    assert.equal(got.unit.regionId, "ph-mnl");
    assert.deepEqual(got.notes, []);
});

// --- the four beside them ----------------------------------------------------

test("off a city said with its kind", async () => {
    const got = await raise("naval", "off city: Manila, country: Philippines");
    assert.equal(got.region, null);
    assert.ok(got.kmFromManila < 80, `${got.kmFromManila} km from Manila`);
    assert.deepEqual(got.notes, []);
});

test("a region this map does not have, called after a town it does: by the town, and said", async () => {
    const got = await raise("air", "region: Metro Manila, country: Philippines");
    assert.equal(got.region?.id, "ph-mnl", "by Manila, not in the middle of the country");
    assert.equal(got.notes.length, 1);
    assert.match(got.notes[0], /^adjusted: .*could not be placed at "region: Metro Manila, country: Philippines" — this map has no place called "Metro Manila"\. It was placed near Manila, in Philippines instead\./);
});

test("a bay the map does not name is the water by the town it is called after, whoever owns the fleet", async () => {
    for (const owner of ["Philippines", "United States"]) {
        const got = await raise("naval", "sea: Manila Bay", owner);
        assert.ok(got.placed, owner);
        assert.equal(got.region, null, `${owner}: at sea`);
        assert.ok(got.kmFromManila < 120, `${owner}: ${got.kmFromManila} km from Manila`);
        assert.match(got.notes[0], /could not be placed at "sea: Manila Bay".* It was placed near Manila, in Philippines instead\./, owner);
    }
});

test("an air base the map does not have is by the capital of the country it is in, and said", async () => {
    const got = await raise("air", "city: Basa Air Base, country: Philippines", "United States");
    assert.equal(got.region?.id, "ph-mnl", "by the capital: not Mindanao, the bulk of the country, and not the owner's own land");
    assert.match(got.notes[0], /this map has no place called "Basa Air Base"\. It was placed near Manila, in Philippines instead\./);
});

// --- a kind is a strong preference, not a wall -----------------------------------

test("a name the map has as the kind it was given is that, and nothing is said", () => {
    const map = mapOf();
    const city = resolvePlacement("city: Manila, country: Philippines", map);
    assert.deepEqual([city.lng, city.lat], MANILA);
    assert.equal(city.otherKind, undefined);
    const region = resolvePlacement("region: Manila, country: Philippines", map);
    assert.equal(region.regionId, "ph-mnl");
    assert.notDeepEqual([region.lng, region.lat], MANILA, "the province, not the town in it");
    assert.equal(region.otherKind, undefined);
});

test("a name the map has only as another kind is used, and the model is told which", async () => {
    const map = mapOf();
    const province = resolvePlacement("city: Tablas, country: Philippines", map);
    assert.equal(province.regionId, "ph-tab");
    assert.deepEqual(province.otherKind, { name: "Tablas", said: "city", is: "region", used: "Tablas" });
    assert.equal(
        describeOtherKind({ title: "T", name: "1st Brigade", phrase: "city: Tablas, country: Philippines", placed: province }),
        'Event "T": 1st Brigade was placed at "city: Tablas, country: Philippines", but this map has no city called "Tablas": the region Tablas was used. Write it as "region: Tablas".',
    );
    assert.equal(describeOtherKind({ placed: resolvePlacement("city: Manila", map) }), "");

    // Through the pass: placed there, with the note, where it used to stand in
    // the middle of the country without one.
    const got = await raise("infantry", "city: Tablas, country: Philippines");
    assert.equal(got.region?.id, "ph-tab");
    assert.match(got.notes[0], /^adjusted: .*this map has no city called "Tablas": the region Tablas was used\./);

    // A sea and a country that are a town.
    for (const written of ["sea: Manila", "country: Manila"]) {
        const placed = resolvePlacement(written, map, { owner: "United States" });
        assert.deepEqual([placed.lng, placed.lat], MANILA, written);
        assert.equal(placed.otherKind.is, "city", written);
    }
    const fleet = await raise("naval", "sea: Manila", "United States");
    assert.equal(fleet.region, null, "and a fleet sent there is put to sea off it");
    assert.ok(fleet.kmFromManila < 80);
});

test("the country an address gives still holds for a name read as another kind", async () => {
    const map = mapOf();
    // Manila is not in Japan as a region or as anything else.
    const plain = resolvePlacement("region: Manila, country: Japan", map, { owner: "Japan" });
    assert.equal(plain.otherKind, undefined);
    assert.equal(map.regionAt([plain.lng, plain.lat])?.owner, "Japan");
    const got = await raise("air", "region: Manila, country: Japan", "Japan");
    assert.equal(got.region?.id, "jp-tyo");
    assert.match(got.notes[0], /this map has no place called "Manila"\. It was placed near Tokyo, in Japan instead\./);
});

test("a region that is only a country: a new unit stands there, a moved one stays where it is", () => {
    const map = mapOf();
    // No region of this map is called Japan.
    assert.ok(resolvePlacement("region: Japan", map).error, "a move is not made on a guess at another kind of thing");
    const raised = resolvePlacement("region: Japan", map, { raising: true });
    assert.equal(map.regionAt([raised.lng, raised.lat])?.owner, "Japan");
    assert.deepEqual(raised.otherKind, { name: "Japan", said: "region", is: "country", used: "Japan" });
    // Any other kind is read for a move too: a town for a province is no leap.
    assert.equal(resolvePlacement("city: Tablas", map).regionId, "ph-tab");
});

// --- the fallbacks always apply to a new unit or structure ------------------------

test("an address whose spot the map lacks is placed approximately and said, for a unit and for a structure", async () => {
    const unit = await raise("infantry", "Camp Aguinaldo, Philippines", "United States");
    assert.equal(unit.region?.id, "ph-mnl");
    assert.match(unit.notes[0], /could not be placed at "Camp Aguinaldo, Philippines" — this map has no place called "Camp Aguinaldo"\. It was placed near Manila, in Philippines instead\./);

    const build = { op: "build", marker: { name: "Fort Bonifacio", type: "fort", ownerCode: "Philippines", at: "building: Fort Bonifacio, country: Philippines" } };
    const { gazetteer, notes } = await run({ markerOps: [build] });
    assert.equal(gazetteer.regionAt([build.marker.lng, build.marker.lat])?.id, "ph-mnl");
    assert.equal(build.marker.approximate?.country, "Philippines", "marked, so its owner can accept it or move it");
    assert.match(notes[0], /It was placed near Manila, in Philippines instead\./);
});

test("a place the map has is never approximated: the province, where it is", async () => {
    const got = await raise("infantry", "region: Tablas, country: Philippines");
    assert.equal(got.region?.id, "ph-tab");
    assert.deepEqual(got.notes, []);
});

test("a structure whose region field names nothing is placed by that name, in its owner's land", async () => {
    const build = { op: "build", regionId: "region: Nowhere At All", marker: { name: "Depot", type: "depot", ownerCode: "Philippines" } };
    const { gazetteer, notes } = await run({ markerOps: [build] });
    assert.equal(gazetteer.regionAt([build.marker.lng, build.marker.lat])?.owner, "Philippines");
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^adjusted: /);
});

test("nothing new placed with a phrase naming a country the map knows is left without coordinates", async () => {
    const phrases = [
        "off Manila, country: Philippines", "region: Manila, country: Philippines", "off city: Manila, country: Philippines",
        "region: Metro Manila, country: Philippines", "city: Basa Air Base, country: Philippines",
        "region: Nowhere At All, country: Philippines", "city: Nowhere At All, country: Philippines",
        "sea: No Such Sea, country: Philippines", "unit: Nonexistent Wing, country: Philippines",
        "building: Fort Bonifacio, country: Philippines", "country: Philippines", "off country: Philippines",
        "Camp Aguinaldo, Philippines", "somewhere in the Philippines", "region: Astana, country: Kazakhstan",
    ];
    for (const type of ["infantry", "air", "naval"]) {
        for (const owner of ["Philippines", "United States"]) {
            for (const at of phrases) {
                const got = await raise(type, at, owner);
                assert.ok(got.placed, `${type} of ${owner} at "${at}": ${JSON.stringify(got.notes)}`);
                assert.equal(got.unit.at, undefined);
                if (type === "naval") assert.equal(got.region, null, `a fleet at "${at}" is at sea`);
                // (This small map has no "nearest land" to bring an army ashore from an "off" phrase.)
                else if (!at.startsWith("off ")) assert.ok(got.region, `${type} at "${at}" is on land`);
            }
        }
    }
});

test("a new fleet raised deep inside another country is put to sea off that country's coast", async () => {
    // (Where that country has no coast it goes to its owner's: placementPass.test.js.)
    const got = await raise("naval", "region: Astana, country: Kazakhstan", "Philippines");
    assert.equal(got.region, null);
    assert.match(got.notes.at(-1), /^adjusted: .*too far from any sea for a fleet, and was put to sea off Astana, on Kazakhstan's own coast, instead\./);
});

// --- the line in the log --------------------------------------------------------

test("an op that names a place and has no coordinates yet is not reported as dropped", (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    // The log's two, as the model wrote them and as the panel read them.
    const raw = [{
        date: "2016-01-02", title: "Kaiju Comes Ashore in Manila Bay", description: "It crossed the breakwater at dawn.",
        impacts: { unitOps: [
            { op: "spawn", unit: { name: "Philippine Fleet Manila Bay Response", type: "naval", ownerCode: "Philippines", strength: 95, at: "off Manila, country: Philippines", posture: "patrol" } },
            { op: "spawn", unit: { name: "Philippine Air Force 5th Fighter Wing", type: "air", ownerCode: "Philippines", strength: 85, at: "region: Manila, country: Philippines", posture: "holding" } },
            { op: "move", unitId: "u-1", at: "city: Manila, country: Philippines" },
            { op: "move", unitId: "u-2", regionId: "region: Manila" },
        ] },
    }];
    // Not on the map yet either: the preview shows them once they are placed.
    assert.equal(normalizeEvents(raw)[0].impacts.unitOps.length, 0);
    assert.deepEqual(warn.mock.calls.map((call) => String(call.arguments[0])), [], "waiting to be placed is not a drop");

    // What is broken is still said: coordinates that are not numbers, an op with nothing at all.
    const broken = [{
        date: "2016-01-02", title: "A second event", description: "…",
        impacts: { unitOps: [
            { op: "spawn", unit: { name: "A", type: "infantry", ownerCode: "Philippines", lng: "east of the city", lat: "north", at: "city: Manila" } },
            { op: "spawn", unit: { name: "B", type: "infantry", ownerCode: "Philippines" } },
            { op: "move", unitId: "u-3" },
        ] },
    }];
    assert.equal(normalizeEvents(broken)[0].impacts.unitOps.length, 0);
    assert.equal(warn.mock.callCount(), 3);
    assert.match(String(warn.mock.calls[0].arguments[0]), /unitOps\[0\] dropped — spawn has unusable coordinates \(lng="east of the city", lat="north"\)/);
});

test("the two of the log end on the map through the pass, and are then kept by the normalizer", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const unitOps = [
        spawnOf("naval", "off Manila, country: Philippines", "Philippines", "Philippine Fleet Manila Bay Response"),
        spawnOf("air", "region: Manila, country: Philippines", "Philippines", "Philippine Air Force 5th Fighter Wing"),
    ];
    await run({ unitOps });
    const kept = normalizeEvents([{ date: "2016-01-02", title: "x", description: "y", impacts: { unitOps } }])[0].impacts.unitOps;
    assert.equal(kept.length, 2);
    assert.ok(kept.every((op) => Number.isFinite(op.unit.lng) && Number.isFinite(op.unit.lat)));
    assert.equal(warn.mock.callCount(), 0);
});

test("a spawn the pass could not place is said in the log by the pass, with its reason", () => {
    const body = source.slice(source.indexOf("const resolvePlacements = async"), end);
    assert.match(body, /console\.warn\(`\[placement\] \$\{entry\.name \|\| "a unit"\} \$\{tried\}; it was left off the map\.`\);/);
    const gameState = readFileSync(new URL("../../runtime/gameState.js", import.meta.url), "utf8");
    assert.match(gameState, /if \(!normalized && !awaitsPlacement\(entry\)\) reportUnitOpDrop\(entry, index, event\);/);
});
