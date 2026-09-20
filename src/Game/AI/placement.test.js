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

import test from "node:test";
import assert from "node:assert/strict";

import {
    DIRECTION_KM,
    NEAR_KM,
    distanceKm,
    hashText,
    interiorPoint,
    nearestInteriorPoint,
    offsetPoint,
    pointInGeometry,
    readPlacement,
    resolvePlacement,
    resolveRegionPlacement,
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
