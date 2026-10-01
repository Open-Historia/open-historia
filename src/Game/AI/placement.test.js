/*! Open Historia — placement: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/placement.test.js
//
// Runs without node_modules: placement.js imports nothing.
//
// A small map with known geometry, so every phrase can be checked against where
// it must land rather than against whatever the code happens to return:
//
//        30        32        34        36        38
//   52   +---------+---------+---------+---------+
//        | Westmark North    | Eastland North    |
//   50   +---------+---------+---------+---------+
//        | Westmark South    | Eastland South    |      (sea everywhere else)
//   48   +---------+---------+---------+---------+
//
// Westmark (30-34 E) and Eastland (34-38 E) share the 34 E border. South of 48 N
// and east of 38 E is open sea. "North Korea" is a fifth region far away, there
// to prove a name that starts with a direction is still a name.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
    DIRECTION_KM,
    NEAR_KM,
    distanceKm,
    hashText,
    interiorPoint,
    nearestInteriorPoint,
    nearestSea,
    offsetPoint,
    pointInGeometry,
    readPlacement,
    describeApproximatePlacement,
    resolvePlacement,
    resolveRegionPlacement,
    seasForMap,
} from "./placement.js";

const box = (west, south, east, north) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const REGIONS = [
    { id: "wm-n", name: "Westmark North", owner: "Westmark", geometry: box(30, 50, 34, 52) },
    { id: "wm-s", name: "Westmark South", owner: "Westmark", geometry: box(30, 48, 34, 50) },
    { id: "el-n", name: "Eastland North", owner: "Eastland", geometry: box(34, 50, 38, 52) },
    { id: "el-s", name: "Eastland South", owner: "Eastland", geometry: box(34, 48, 38, 50) },
    { id: "nk", name: "North Korea", owner: "North Korea", geometry: box(125, 38, 130, 42) },
];
const CITIES = [
    { name: "Midburg", point: [32, 51] },       // middle of Westmark North
    { name: "Porthaven", point: [36, 48.2] },   // on Eastland South's southern shore
    { name: "Gold Coast", point: [31, 49] },    // a town whose NAME says "coast"
];
const UNITS = [{ id: "u-1", name: "1st Guards Army", point: [35, 51] }];

const fold = (value) => String(value ?? "").trim().toLowerCase();
// Loose the way the real gazetteer is loose: unless asked for an exact name, a
// phrase that CONTAINS a name as a whole word finds it ("off Porthaven" would
// find Porthaven), which is what the `exact` flag on the whole-phrase reading
// exists to stop.
const containsWord = (outer, inner) => outer === inner || outer.startsWith(`${inner} `) || outer.endsWith(` ${inner}`) || outer.includes(` ${inner} `);
const gazetteer = {
    find: (name, { exact = false } = {}) => {
        const key = fold(name);
        const matches = (candidate) => (exact ? fold(candidate) === key : containsWord(key, fold(candidate)));
        const unit = UNITS.find((entry) => fold(entry.id) === key || matches(entry.name));
        if (unit) return { kind: "unit", name: unit.name, point: unit.point };
        const city = CITIES.find((entry) => matches(entry.name));
        if (city) return { kind: "city", name: city.name, point: city.point };
        const region = REGIONS.find((entry) => matches(entry.name));
        if (region) return { kind: "region", name: region.name, region };
        const owned = REGIONS.filter((entry) => matches(entry.owner));
        if (owned.length) return { kind: "polity", name: owned[0].owner, regions: owned };
        return null;
    },
    regionAt: (point) => REGIONS.find((region) => pointInGeometry(point, region.geometry)) ?? null,
    findRegionId: (id) => REGIONS.find((region) => region.id === String(id ?? "").trim()) ?? null,
};
const place = (phrase, seedText = "") => resolvePlacement(phrase, gazetteer, { seedText });

// --- a destination given as a region id ---

test("a region id lands inside that region, and says which region it is", () => {
    const spot = resolveRegionPlacement("el-s", gazetteer, { seedText: "u-1" });
    assert.equal(spot.error, undefined);
    assert.equal(pointInGeometry([spot.lng, spot.lat], REGIONS[3].geometry), true, `${spot.lng},${spot.lat} is not in Eastland South`);
    assert.equal(spot.regionId, "el-s");
    assert.equal(spot.regionName, "Eastland South");
});

test("the same region id and unit land in the same spot every time", () => {
    const first = resolveRegionPlacement("wm-n", gazetteer, { seedText: "u-1" });
    const again = resolveRegionPlacement("wm-n", gazetteer, { seedText: "u-1" });
    assert.deepEqual([first.lng, first.lat], [again.lng, again.lat]);
});

test("an id no region has says so, in words the model can act on", () => {
    assert.match(resolveRegionPlacement("116", gazetteer).error, /no region on this map has the id "116"/);
    assert.equal(resolveRegionPlacement("", gazetteer).error, "no region id");
    assert.equal(resolveRegionPlacement("wm-n", { regionAt: () => null }).error, 'no region on this map has the id "wm-n"');
});

test("a phrase that finds nothing reports every place it could have been naming", () => {
    // The receipt quotes what the model wrote, but "Falkland Islands" inside
    // "off Falkland Islands" is what a caller can offer near misses for.
    const missed = place("off Nowhereshire");
    assert.match(missed.error, /is called "off Nowhereshire"/);
    assert.deepEqual(missed.names, ["off Nowhereshire", "Nowhereshire"]);
    assert.deepEqual(
        place("between Nowhereshire and Elsewhere").names,
        ["between Nowhereshire and Elsewhere", "Nowhereshire", "Elsewhere"],
        "the whole phrase, then each end of it",
    );
});

// --- seas and oceans ---
//
// Seen in a player's Game (2026-09-30): a fleet sent to "Central Mediterranean,
// Mediterranean Sea", "Ionian Sea, Eastern Mediterranean" and "Black Sea" could
// be placed at none of them, because the map names no water, and it stopped.
//
// The test map stands in for the real world here: its gazetteer is handed the
// real seas, as the game's is when the real-world map is loaded.
const earthGazetteer = { ...gazetteer, seas: seasForMap({ regionIds: ["UKR.11_1", "UKR.12_1", "ROU.3_1"] }) };
const placeOnEarth = (phrase) => resolvePlacement(phrase, earthGazetteer);

test("a named sea is open water in that sea, whatever words come with it", () => {
    for (const [phrase, label] of [
        ["Black Sea", "Black Sea"],
        ["the Black Sea", "Black Sea"],
        ["Ionian Sea, Eastern Mediterranean", "Ionian Sea"],
        ["Central Mediterranean, Mediterranean Sea", "Central Mediterranean"],
        ["in the South Atlantic", "South Atlantic"],
    ]) {
        const spot = placeOnEarth(phrase);
        assert.equal(spot.error, undefined, phrase);
        assert.equal(spot.how, "sea", phrase);
        assert.equal(spot.label, label, phrase);
        assert.equal(gazetteer.regionAt([spot.lng, spot.lat]), null, `${phrase} is at sea`);
    }
    assert.ok(distanceKm([placeOnEarth("Black Sea").lng, placeOnEarth("Black Sea").lat], [34, 43.2]) < 1);
});

test("the real seas are the real-world map's only: a map of its own does not know the Black Sea", () => {
    assert.ok(seasForMap({ regionIds: ["UKR.11_1", "GBR.1_1"] }).some((sea) => sea.name === "Black Sea"));
    // A hand-drawn world: its own ids, perhaps a re-owned stock row or two.
    const ownMap = seasForMap({ regionIds: ["westeros-north", "westeros-vale", "essos-pentos", "UKR.11_1"] });
    assert.deepEqual(ownMap, []);
    assert.deepEqual(seasForMap({ regionIds: [] }), []);

    const spot = resolvePlacement("Black Sea", { ...gazetteer, seas: ownMap });
    assert.equal(spot.how, undefined);
    assert.match(spot.error, /Black Sea/);
    assert.match(place("Black Sea").error, /Black Sea/, "and a gazetteer with no seas at all knows none");
});

test("a map of its own places fleets in the seas its scenario declares", () => {
    const seas = seasForMap({
        regionIds: ["el-n", "el-s", "wm-n"],
        declared: [
            { name: "Narrow Sea", aliases: ["the Narrows"], point: [36, 45] },
            { name: "Sunset Sea", lng: 20, lat: 45 },
            { name: "Nowhere Sea" },
            { aliases: ["no name"], point: [1, 1] },
        ],
    });
    assert.deepEqual(seas.map((sea) => sea.name), ["Narrow Sea", "Sunset Sea"], "an entry without a name or a point is skipped");
    const own = { ...gazetteer, seas };
    for (const phrase of ["Narrow Sea", "the Narrows", "into the Narrow Sea"]) {
        const spot = resolvePlacement(phrase, own);
        assert.equal(spot.how, "sea", phrase);
        assert.equal(spot.label, "Narrow Sea", phrase);
        assert.deepEqual([spot.lng, spot.lat], [36, 45], phrase);
    }
    assert.equal(resolvePlacement("Sunset Sea", own).how, "sea");

    // On the real-world map too, and a scenario's own sea wins a shared name.
    const earth = seasForMap({ regionIds: ["UKR.11_1"], declared: [{ name: "Black Sea", point: [31, 44] }] });
    assert.deepEqual(earth.find((sea) => sea.name === "Black Sea").point, [31, 44]);
    assert.ok(earth.some((sea) => sea.name === "Ionian Sea"));
});

test("a place the map names is preferred to a sea of the same name", () => {
    const named = resolvePlacement("Black Sea", { ...gazetteer, find: (name) => (fold(name) === "black sea" ? { kind: "marker", name: "Black Sea", point: [31, 51] } : null) });
    assert.deepEqual([named.lng, named.lat], [31, 51]);
});

test("a region name written where the regionId goes still places the move", () => {
    const spot = resolveRegionPlacement("Eastland South", gazetteer, { seedText: "u-1" });
    assert.equal(spot.error, undefined);
    assert.equal(spot.regionId, "el-s");
});

test("a point on land goes to the sea off that coast; a point at sea stays put", () => {
    const off = nearestSea([36, 48.3], gazetteer);
    assert.ok(off, "Eastland South has a southern shore");
    assert.equal(gazetteer.regionAt(off), null);
    assert.ok(distanceKm(off, [36, 48.3]) < 120, "and it is the water nearest the port");
    assert.deepEqual(nearestSea([36, 45], gazetteer), [36, 45]);
});

test("a fleet put on land is moved to sea in the placement pass", () => {
    const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("const resolvePlacements = async"), source.indexOf("// The system prompt a task is sent"));
    assert.ok(body.includes('atSea: normalizeString(mover?.type).toLowerCase() === "naval"'), "a moving fleet is marked");
    assert.ok(body.includes("entry.atSea && gazetteer.regionAt([lng, lat])") && body.includes("nearestSea([lng, lat], gazetteer"), "and taken off the land");
});

// --- geometry ---

test("a point is inside a polygon, outside it, and outside its hole", () => {
    const ring = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
    assert.equal(pointInGeometry([2, 2], ring), true);
    assert.equal(pointInGeometry([5, 5], ring), false, "in the lake");
    assert.equal(pointInGeometry([12, 2], ring), false);
    assert.equal(pointInGeometry([2, 2], null), false);
});

test("the interior point of a crescent is inside the crescent, where its centroid is not", () => {
    // A thick "C": the bbox centre [5,5] falls in the mouth of it.
    const crescent = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10], [0, 0]]] };
    assert.equal(pointInGeometry([5, 5], crescent), false);
    const inner = interiorPoint(crescent);
    assert.equal(pointInGeometry(inner, crescent), true);
});

test("the nearest interior point is on the side of the target, and still inside", () => {
    const region = box(30, 48, 34, 50);
    const east = nearestInteriorPoint(region, [40, 49]);
    const west = nearestInteriorPoint(region, [20, 49]);
    assert.equal(pointInGeometry(east, region), true);
    assert.ok(east[0] > 33 && west[0] < 31, `${east} / ${west}`);
});

test("an offset goes the way the compass says, and about as far", () => {
    const origin = [36, 50];
    const north = offsetPoint(origin, 0, 100);
    const east = offsetPoint(origin, 90, 100);
    assert.ok(north[1] > origin[1] && Math.abs(north[0] - origin[0]) < 1e-9);
    assert.ok(east[0] > origin[0] && Math.abs(east[1] - origin[1]) < 1e-9);
    assert.ok(Math.abs(distanceKm(origin, north) - 100) < 1 && Math.abs(distanceKm(origin, east) - 100) < 1);
});

// --- reading ---

test("the whole phrase is always read as a name first — exactly, when it could also be grammar", () => {
    for (const phrase of ["North Korea", "Gold Coast", "near Midburg", "east of Midburg"]) {
        assert.deepEqual(readPlacement(phrase)[0], { kind: "place", name: phrase, exact: true });
    }
    assert.deepEqual(readPlacement("Midburg"), [{ kind: "place", name: "Midburg" }], "a bare name may be matched loosely");
});

test("a loose match on the whole phrase does not beat its grammar", () => {
    // The gazetteer would find Porthaven in "off Porthaven" and Midburg in
    // "near Midburg" if asked loosely; the whole-phrase reading must not ask.
    assert.equal(place("off Porthaven").how, "offshore");
    assert.equal(place("near Midburg", "3rd Army").how, "near");
    assert.equal(place("east of Midburg").how, "direction");
    assert.equal(place("northern Westmark").how, "part");
    // While a name the map does spell that way is still the name.
    assert.equal(place("North Korea").regionId, "nk");
    assert.equal(place("Gold Coast").how, "at");
});

test("each form of words is read as what it says", () => {
    const kinds = (phrase) => readPlacement(phrase).map((reading) => reading.kind);
    assert.ok(kinds("near Midburg").includes("near"));
    assert.ok(kinds("just outside Midburg").includes("near"));
    // An objective is a destination beside the place; the move's travel clamp does the rest.
    assert.ok(kinds("toward Midburg").includes("near"));
    assert.ok(kinds("advancing on Midburg").includes("near"));
    assert.deepEqual(readPlacement("north-west of Midburg").find((r) => r.kind === "direction"), { kind: "direction", direction: "northwest", name: "Midburg" });
    assert.deepEqual(readPlacement("eastern Westmark").find((r) => r.kind === "part"), { kind: "part", direction: "east", name: "Westmark" });
    assert.deepEqual(readPlacement("Westmark South, north").find((r) => r.kind === "part"), { kind: "part", direction: "north", name: "Westmark South" });
    assert.deepEqual(readPlacement("the north of Westmark South").find((r) => r.kind === "part"), { kind: "part", direction: "north", name: "Westmark South" });
    assert.deepEqual(readPlacement("coast of Eastland").find((r) => r.kind === "coast"), { kind: "coast", name: "Eastland" });
    assert.deepEqual(readPlacement("off the coast of Eastland").find((r) => r.kind === "offshore"), { kind: "offshore", name: "Eastland" });
    assert.deepEqual(readPlacement("Westmark South facing Eastland").find((r) => r.kind === "facing"), { kind: "facing", name: "Westmark South", toward: "Eastland" });
    assert.deepEqual(readPlacement("the border of Westmark with Eastland").find((r) => r.kind === "facing"), { kind: "facing", name: "Westmark", toward: "Eastland" });
    assert.deepEqual(readPlacement("between Midburg and Porthaven").find((r) => r.kind === "between"), { kind: "between", first: "Midburg", second: "Porthaven" });
});

test("coordinates are longitude then latitude, and nonsense is not a place", () => {
    assert.deepEqual(readPlacement("[36.2, 50.0]"), [{ kind: "coordinates", point: [36.2, 50] }]);
    assert.deepEqual(readPlacement("36.2, 50"), [{ kind: "coordinates", point: [36.2, 50] }]);
    assert.deepEqual(readPlacement("[0, 0]"), [], "null island is a model that did not know");
    assert.deepEqual(readPlacement("[400, 50]"), []);
    assert.deepEqual(readPlacement("   "), []);
});

// --- resolving ---

test("a name is the place itself: a city where it stands, a unit where it is, a region inside it", () => {
    assert.deepEqual([place("Midburg").lng, place("Midburg").lat, place("Midburg").regionId], [32, 51, "wm-n"]);
    assert.deepEqual([place("1st Guards Army").lng, place("1st Guards Army").lat], [35, 51]);
    assert.deepEqual([place("u-1").lng, place("u-1").lat], [35, 51], "a unit is found by its id as well");
    const region = place("Eastland South");
    assert.equal(region.regionId, "el-s");
    assert.equal(region.how, "inside");
});

test("a name that starts with a direction, or says coast, is still the name", () => {
    assert.equal(place("North Korea").regionId, "nk");
    assert.deepEqual([place("Gold Coast").lng, place("Gold Coast").lat], [31, 49]);
});

test("near is beside it, on land, and not on top of it", () => {
    const near = place("near Midburg", "3rd Army");
    assert.equal(near.how, "near");
    assert.equal(near.regionId, "wm-n");
    assert.ok(Math.abs(distanceKm([near.lng, near.lat], [32, 51]) - NEAR_KM) < 1);
    // Beside a port: the compass is walked round until the point is on land.
    const port = place("near Porthaven", "Harbour Guard");
    assert.ok(port.regionId, "must not be put in the sea");
});

test("a direction from a city is that way, a short way off", () => {
    const east = place("east of Midburg");
    assert.ok(east.lng > 32 && Math.abs(east.lat - 51) < 0.01);
    assert.ok(Math.abs(distanceKm([east.lng, east.lat], [32, 51]) - DIRECTION_KM) < 1);
    assert.ok(place("south-west of Midburg").lng < 32 && place("south-west of Midburg").lat < 51);
});

test("a part of a region is inside that part of it", () => {
    const north = place("Westmark South, north");
    assert.equal(north.regionId, "wm-s");
    assert.ok(north.lat > 49, String(north.lat));
    const southEast = place("south-eastern Eastland North");
    assert.equal(southEast.regionId, "el-n");
    assert.ok(southEast.lat < 51 && southEast.lng > 36, JSON.stringify(southEast));
});

test("a part of a COUNTRY picks the region in that part of it", () => {
    assert.equal(place("southern Westmark").regionId, "wm-s");
    assert.equal(place("northern Westmark").regionId, "wm-n");
    assert.equal(place("the north of Eastland").regionId, "el-n");
});

test("facing puts a thing on the side of one place nearest another", () => {
    const front = place("Westmark South facing Eastland");
    assert.equal(front.regionId, "wm-s");
    assert.ok(front.lng > 33, `should hug the 34 E border, was ${front.lng}`);
    // A country facing a country: its region nearest the other, then that side of it.
    const border = place("the border of Eastland with Westmark");
    assert.ok(["el-n", "el-s"].includes(border.regionId));
    assert.ok(border.lng < 35, String(border.lng));
});

test("the coast is on land at the sea's edge; offshore is in the sea", () => {
    const coast = place("coast of Eastland South");
    assert.equal(coast.regionId, "el-s");
    assert.equal(coast.how, "coast");
    assert.ok(coast.lat < 48.6 || coast.lng > 37.4, `should be at the south or east shore, was ${coast.lng},${coast.lat}`);

    const fleet = place("off Porthaven");
    assert.equal(fleet.how, "offshore");
    assert.equal(fleet.regionId, "", "at sea is in no region");
    assert.ok(fleet.lat < 48, String(fleet.lat));
});

test("a country's coast is found on whichever of its regions has one", () => {
    const coast = place("coast of Westmark");
    assert.ok(coast.regionId.startsWith("wm-"));
    assert.equal(coast.how, "coast");
});

test("halfway between two places is halfway", () => {
    const mid = place("between Midburg and Porthaven");
    assert.deepEqual([mid.lng, mid.lat], [34, 49.6]);
});

test("coordinates are taken as given, and say which region they fall in", () => {
    const point = place("[35.5, 49.5]");
    assert.deepEqual([point.lng, point.lat, point.regionId, point.how], [35.5, 49.5, "el-s", "coordinates"]);
    assert.equal(place("[20, 20]").regionId, "");
});

test("a place that is not on the map says so, by the name that was not found", () => {
    assert.match(place("near Atlantis").error, /is called "near Atlantis"|is called "Atlantis"/);
    assert.match(place("").error, /is not a place/);
    assert.match(place("Westmark South facing Atlantis").error, /no city, region, unit or structure/);
});

test("the same phrase for the same thing is the same point, and a different thing may differ", () => {
    assert.deepEqual(place("near Midburg", "3rd Army"), place("near Midburg", "3rd Army"));
    assert.deepEqual(place("Eastland South", "x"), place("Eastland South", "x"));
    assert.equal(hashText("abc"), hashText("abc"));
    assert.notEqual(hashText("abc"), hashText("abd"));
});

test("a gazetteer that throws on one odd region costs that reading, not the placement", () => {
    const brittle = { ...gazetteer, regionAt: (point) => { if (point[0] > 100) throw new Error("bad polygon"); return gazetteer.regionAt(point); } };
    assert.equal(resolvePlacement("Midburg", brittle).regionId, "wm-n");
    assert.ok(resolvePlacement("North Korea", brittle).error);
});

// --- a border with no first place named ---
//
// A player's diagnostics log (beta 0.0.50): Ecuador mobilised a brigade and the
// model placed it at "northern frontier with Colombia", then, told that was not
// a place, at "northern border with Colombia". Both named no first place, so
// neither was read, and the brigade never appeared — twice.

test("a border with no first place named is the unit's own side of it", () => {
    for (const phrase of ["northern frontier with Eastland", "northern border with Eastland", "along the border with Eastland", "the Eastland border", "Eastland frontier"]) {
        const spot = resolvePlacement(phrase, gazetteer, { seedText: "1st Brigade", owner: "Westmark" });
        assert.equal(spot.error, undefined, phrase);
        assert.ok(["wm-n", "wm-s"].includes(spot.regionId), `${phrase}: landed in ${spot.regionId}, not on Westmark's side`);
        assert.ok(spot.lng > 33, `${phrase}: should hug the 34 E border, was ${spot.lng}`);
    }
    // Eastland's own unit at "the border with Westmark" is on Eastland's side.
    const theirs = resolvePlacement("the border with Westmark", gazetteer, { seedText: "2nd Brigade", owner: "Eastland" });
    assert.ok(["el-n", "el-s"].includes(theirs.regionId), String(theirs.regionId));
    assert.ok(theirs.lng < 35, String(theirs.lng));
    // Without an owner there is no side to put it on, so no such reading is offered.
    assert.equal(readPlacement("northern frontier with Eastland").some((reading) => reading.kind === "facing"), false);
});

test("words for a kind of ground after a name are tried without them, after the phrase as written", () => {
    const readings = readPlacement("near Putumayo jungle frontier");
    assert.deepEqual(readings.find((reading) => reading.kind === "near" && reading.name === "Putumayo"), { kind: "near", name: "Putumayo" });
    const asWritten = readings.findIndex((reading) => reading.kind === "near" && reading.name === "Putumayo jungle frontier");
    const stripped = readings.findIndex((reading) => reading.kind === "near" && reading.name === "Putumayo");
    assert.ok(asWritten >= 0 && asWritten < stripped, "the phrase as written is tried first");
    assert.ok(readPlacement("Northern Region").some((reading) => reading.name === "Northern Region" && reading.kind === "place"), "a real name ending in one is still tried whole");
    assert.equal(readPlacement("Midburg").length, 1, "a bare name is one reading");
});

test("the Workshop-free pipeline: a new formation nothing places is raised in its owner's own territory", () => {
    // resolvePlacements lives in gameplay.js, which does not load under bare
    // node; its fallback is the owner's own name, resolved here exactly as it is
    // resolved there, and the wiring is checked in its source.
    const home = resolvePlacement("Westmark", gazetteer, { seedText: "Ecuadorian 1st Infantry Brigade" });
    assert.equal(home.error, undefined);
    assert.ok(["wm-n", "wm-s"].includes(home.regionId));
    const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("const resolvePlacements = async"), source.indexOf("// The system prompt a task is sent"));
    assert.ok(body.includes("owner: entry.owner"), "the unit's owner reaches the phrase reader");
    assert.ok(body.includes("entry.spawn && entry.owner") && body.includes("resolvePlacement(entry.owner, gazetteer"), "a spawn with nowhere to go is raised at home");
    assert.ok(body.includes("rather than left off the map"), "and the receipt says where it went");
});

// --- approximate placement: a place the map does not know ---
//
// Seen in a live game (2026-09-27): a base ordered at Djibo, Burkina Faso was
// dropped because the Scenario's map has no Djibo. Now it goes near the capital
// of the country the phrase names, or into the owner's own land, and says so.

// Westmark's capital is Midburg; Eastland marks none.
const CAPITALS = { westmark: { name: "Midburg", point: [32, 51] } };
// Exact names only: the test map's loose matching would read "Nowhereville,
// Westmark" as Westmark itself, which the real map does not.
const mapped = {
    ...gazetteer,
    find: (name, options = {}) => gazetteer.find(name, { ...options, exact: true }),
    capitalOf: (country) => CAPITALS[fold(country)] ?? null,
    // The places an event's text names, in the order it names them, held by that
    // country: the real gazetteer reads its regions and cities the same way.
    placesNamedIn: (text, country) => [...REGIONS.map((region) => ({ name: region.name, region, owner: region.owner })),
        ...CITIES.map((city) => ({ name: city.name, point: city.point, owner: gazetteer.regionAt(city.point)?.owner }))]
        .map((place) => ({ ...place, at: fold(text).indexOf(fold(place.name)) }))
        .filter((place) => place.at >= 0 && fold(place.owner) === fold(country))
        .sort((a, b) => a.at - b.at),
};
const approx = (phrase, { owner = "", seedText = "Probe Base", context = "" } = {}) =>
    resolvePlacement(phrase, mapped, { seedText, owner, approximate: true, context });
const inRegion = (spot, id) => pointInGeometry([spot.lng, spot.lat], REGIONS.find((region) => region.id === id).geometry);
const inCountry = (spot, owner) => REGIONS.some((region) => region.owner === owner && pointInGeometry([spot.lng, spot.lat], region.geometry));

test("a place the map knows is placed exactly, never approximately", () => {
    const spot = approx("Midburg");
    assert.equal(spot.approximate, undefined);
    assert.deepEqual([spot.lng, spot.lat], [32, 51]);
});

test("an unknown town in a named country goes near that country's capital", () => {
    for (const phrase of ["Nowhereville, Westmark", "Nowhereville in Westmark", "Westmark's Nowhereville district"]) {
        const spot = approx(phrase, { owner: "Eastland" });
        assert.equal(spot.error, undefined, phrase);
        assert.equal(inCountry(spot, "Westmark"), true, `${phrase}: ${spot.lng},${spot.lat} is not in Westmark`);
        assert.ok(distanceKm([spot.lng, spot.lat], [32, 51]) <= 50, `${phrase}: too far from Midburg`);
        assert.deepEqual(spot.approximate, { asked: phrase, country: "Westmark", near: "Midburg" }, phrase);
    }
});

// Seen in a player's Game (2026-09-29): an unknown town beside a province
// the map knows went near Cardiff, the first capital its country marks. The province the phrase names is where the thing goes.
test("a known province in the phrase is where the thing goes when the town is unknown", () => {
    const spot = approx("Nowhereville, Eastland North", { owner: "Westmark" });
    assert.equal(inRegion(spot, "el-n"), true, `${spot.lng},${spot.lat} is not in Eastland North`);
    assert.equal(spot.approximate.country, "Eastland");
    assert.equal(spot.approximate.near, "Eastland North");
});

test("a known city in the phrase is where the thing goes, near it and in its country", () => {
    const spot = approx("Nowhereville, Midburg", { owner: "Eastland" });
    assert.equal(inCountry(spot, "Westmark"), true);
    assert.ok(distanceKm([spot.lng, spot.lat], [32, 51]) <= 50);
    assert.equal(spot.approximate.near, "Midburg");
});

// The same Game: the event named a province, and the phrase only the town and
// its country. What the event itself names, in that country,
// comes before the capital.
test("a place the event names in that country comes before its capital", () => {
    const spot = approx("Nowhereville, Westmark", { context: "The division completes its redeployment across Westmark South and arrives at Nowhereville." });
    assert.equal(inRegion(spot, "wm-s"), true, `${spot.lng},${spot.lat} is not in Westmark South`);
    assert.equal(spot.approximate.near, "Westmark South");
});

test("a place the event names in another country is not used", () => {
    const spot = approx("Nowhereville, Westmark", { context: "Troops leave Eastland North for Nowhereville." });
    assert.equal(spot.approximate.near, "Midburg");
    assert.equal(inCountry(spot, "Westmark"), true);
});

test("a phrase that names no country goes into the owner's own land", () => {
    const spot = approx("Nowhereville", { owner: "Westmark" });
    assert.equal(inCountry(spot, "Westmark"), true);
    assert.equal(spot.approximate.country, "Westmark");
    assert.ok(distanceKm([spot.lng, spot.lat], [32, 51]) <= 50);
});

test("the same thing lands in the same spot every time", () => {
    const first = approx("Nowhereville, Westmark", { seedText: "Djibo Forward Operating Base" });
    const again = approx("Nowhereville, Westmark", { seedText: "Djibo Forward Operating Base" });
    assert.deepEqual([first.lng, first.lat], [again.lng, again.lat]);
});

test("with no country named and an owner that holds no land, nothing is placed", () => {
    const spot = approx("Nowhereville", { owner: "Atlantis" });
    assert.match(spot.error ?? "", /is called "Nowhereville"/);
    assert.equal(spot.approximate, undefined);
});

test("without the approximate option an unknown place is still an error", () => {
    assert.match(resolvePlacement("Nowhereville", mapped, { owner: "Eastland" }).error ?? "", /is called/);
});

test("two things placed approximately in one country land in different spots", () => {
    // Spacing (featureSpacing.js) keeps them clear once placed; the name already
    // spreads them, so several bases do not start from one point.
    const first = approx("Nowhereville, Westmark", { seedText: "Djibo Forward Operating Base" });
    const second = approx("Elsewhere, Westmark", { seedText: "Dori Supply Depot" });
    assert.notDeepEqual([first.lng, first.lat], [second.lng, second.lat]);
});

// Seen in a replayed turn (2026-09-29): the structure director built a forward
// operating base with no `at`, and its event named nowhere the map knows. It
// goes into its owner's land like an unknown town, marked as given no place.
test("a thing given no place at all goes into its owner's land, marked unnamed", () => {
    const spot = approx("", { owner: "Westmark", context: "Engineers break ground on a base at Nowhereville." });
    assert.equal(inCountry(spot, "Westmark"), true);
    assert.deepEqual(spot.approximate, { asked: "", country: "Westmark", near: "Midburg", unnamed: true });
    assert.equal(
        describeApproximatePlacement({ title: "A Base Is Begun", name: "Nowhereville Base", phrase: "", placed: spot }),
        'Event "A Base Is Begun": Nowhereville Base was given no place. It was placed near Midburg, in Westmark instead. Give every new unit and structure `at`.',
    );
    assert.equal(approx("", { owner: "Atlantis" }).approximate, undefined, "no owner's land, nowhere to go");
});

test("the model is told what it named, and where the thing went instead", () => {
    const placed = approx("Nowhereville, Westmark", { owner: "Eastland" });
    assert.equal(
        describeApproximatePlacement({ title: "A Base at Nowhereville", name: "Nowhereville Base", phrase: "Nowhereville, Westmark", reason: "not on this map", placed }),
        'Event "A Base at Nowhereville": Nowhereville Base could not be placed at "Nowhereville, Westmark" — not on this map. '
        + "It was placed near Midburg, in Westmark instead. Name a city or province this map knows to place it exactly.",
    );
    const province = approx("Nowhereville, Eastland North", { owner: "Westmark" });
    assert.match(describeApproximatePlacement({ name: "Depot", phrase: "Nowhereville, Eastland North", placed: province }), /placed near Eastland North, in Eastland instead/);
    const inside = approx("Nowhereville, Eastland", { owner: "Westmark" });
    assert.match(describeApproximatePlacement({ name: "Depot", phrase: "Nowhereville, Eastland", placed: inside }), /placed in Eastland instead/);
    assert.equal(describeApproximatePlacement({ placed: place("Midburg") }), "", "an exact placement is not reported");
});
