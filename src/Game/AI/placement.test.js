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

test("halfway between two places across the date line stays in the Pacific", () => {
    const islands = [{ name: "Fiji", point: [178, -18] }, { name: "Samoa", point: [-172, -13.8] }];
    const pacific = {
        find: (name) => {
            const island = islands.find((entry) => fold(entry.name) === fold(name));
            return island ? { kind: "city", name: island.name, point: island.point } : null;
        },
        regionAt: () => null,
        findRegionId: () => null,
    };
    for (const phrase of ["between Fiji and Samoa", "between Samoa and Fiji"]) {
        const mid = resolvePlacement(phrase, pacific);
        assert.deepEqual([mid.lng, mid.lat], [-177, -15.9], phrase);
    }
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

// --- an address: a spot, and what it is in ---
//
// "Fort Drum, New York". A real skip opened a depot there and lost it: no map
// carries every base, and the phrase as a whole named nothing.

test("a spot the map does not have is put in the place the address says it is in", () => {
    const spot = place("Fort Nowhere, Westmark North");
    assert.equal(spot.error, undefined);
    assert.equal(spot.regionId, "wm-n");
    const deeper = place("Fort Nowhere, Midburg, Westmark");
    assert.deepEqual([deeper.lng, deeper.lat], [32, 51], "the innermost place the map knows: the town, not the whole country");
    const country = place("Fort Nowhere, Eastland");
    assert.ok(["el-n", "el-s"].includes(country.regionId), String(country.regionId));
});

test("a spot the map has is the spot itself, when it is where the address says", () => {
    const spot = place("Midburg, Westmark North");
    assert.deepEqual([spot.lng, spot.lat], [32, 51]);
    assert.deepEqual([place("Midburg, Westmark").lng, place("Midburg, Westmark").lat], [32, 51], "inside the country too");
});

test("a namesake somewhere else is not the spot: the address wins", () => {
    // The map's only Midburg is in Westmark. "Midburg, Eastland" is some other Midburg.
    const spot = place("Midburg, Eastland");
    assert.equal(spot.error, undefined);
    assert.ok(["el-n", "el-s"].includes(spot.regionId), `${spot.regionId} is not in Eastland`);
});

test("when the map knows nothing after the comma, the spot is taken only at home", () => {
    // No "Nowhereshire" on this map, so nothing says which Midburg is meant.
    const home = resolvePlacement("Midburg, Nowhereshire", gazetteer, { owner: "Westmark" });
    assert.deepEqual([home.lng, home.lat], [32, 51], "it is in the owner's own land");
    const abroad = resolvePlacement("Midburg, Nowhereshire", gazetteer, { owner: "Eastland" });
    assert.match(abroad.error, /is called "Midburg, Nowhereshire"/, "a namesake abroad is refused, and the receipt says what was written");
    const structure = resolvePlacement("Midburg, Nowhereshire", gazetteer, { home: "Eastland" });
    assert.match(structure.error, /Midburg, Nowhereshire/, "a structure's owner is given as `home`");
    const nobody = resolvePlacement("Midburg, Nowhereshire", gazetteer);
    assert.deepEqual([nobody.lng, nobody.lat], [32, 51], "with nobody to test it against, it is taken");
});

// --- a side of a country, with no country named ---

test("the northern border, with nobody named, is the north of whoever is placing the thing", () => {
    const unit = resolvePlacement("northern border", gazetteer, { seedText: "Exercise Force", owner: "Westmark" });
    assert.equal(unit.error, undefined);
    assert.equal(unit.regionId, "wm-n", "Westmark's northern region");
    const depot = resolvePlacement("along the eastern frontier", gazetteer, { seedText: "Depot", home: "Westmark" });
    assert.ok(["wm-n", "wm-s"].includes(depot.regionId) && depot.lng > 32, `${depot.regionId} ${depot.lng}: a structure's owner is its home`);
    const south = resolvePlacement("our southern provinces", gazetteer, { owner: "Eastland" });
    assert.equal(south.regionId, "el-s");
    // Nobody's: there is no side to put it on, so it is not read that way at all.
    assert.equal(readPlacement("northern border").some((reading) => reading.kind === "part" && reading.name !== "border"), false);
    assert.match(resolvePlacement("northern border", gazetteer).error, /northern border/);
});

test("a named place still wins over the side of the owner's own land", () => {
    // "Eastland North" is a region; its owner's north is only tried after it.
    const named = resolvePlacement("Eastland North", gazetteer, { owner: "Westmark" });
    assert.equal(named.regionId, "el-n");
    const border = resolvePlacement("the border with Eastland", gazetteer, { owner: "Westmark" });
    assert.ok(border.lng > 33, "a border WITH someone is still the side facing them");
});

test("an address after a word of grammar is still an address", () => {
    const near = place("near Fort Nowhere, Eastland South");
    assert.equal(near.error, undefined);
    assert.equal(near.regionId, "el-s");
    const at = place("at Fort Nowhere, Midburg, Westmark");
    assert.deepEqual([at.lng, at.lat], [32, 51]);
});

test("an address is the last reading: grammar after a comma still means what it meant", () => {
    const north = place("Westmark North, north");
    assert.equal(north.regionId, "wm-n");
    assert.ok(north.lat > 51, `${north.lat} is not in the north of it`);
    assert.match(place("Fort Nowhere, Elsewhere").error, /is called "Fort Nowhere, Elsewhere"/, "nothing on the map either side of the comma");
    assert.match(place("Fort Nowhere").error, /is called "Fort Nowhere"/, "no comma, no address");
});

test("an address asks the map for the same names several times over", () => {
    // Why the gazetteer answers each name once (the next test): one phrase the
    // map does not have is read several ways, and each way asks again.
    const asked = [];
    const counting = { ...gazetteer, find: (name, options) => { asked.push(`${options?.exact ? "=" : "~"}${name}`); return gazetteer.find(name, options); } };
    const result = resolvePlacement("near Fort Nowhere, Elsewhere", counting, { owner: "Westmark" });
    assert.match(result.error, /is called/);
    assert.ok(asked.length > new Set(asked).size + 3, `${asked.length} lookups for ${new Set(asked).size} different questions`);
});

test("the map's gazetteer works each name out once", () => {
    const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("const buildPlacementGazetteer = "), source.indexOf("const resolvePlacements = async"));
    // The lookup itself, then the door in front of it: keyed by the name as it
    // was written and by whether only the map's own spelling will do.
    assert.ok(body.includes("const lookUp = (name, exactOnly) => {"));
    assert.ok(body.includes("const lookedUp = new Map();"));
    assert.ok(body.includes("const memoKey = `${exactOnly ? \"=\" : \"~\"}${String(name ?? \"\")}`;"));
    assert.ok(body.includes("if (!lookedUp.has(memoKey)) lookedUp.set(memoKey, lookUp(name, Boolean(exactOnly)));"));
    // One gazetteer per placing pass, built from the world that pass reads, so
    // nothing it remembers outlives the units and structures it was read from.
    const pass = source.slice(source.indexOf("const resolvePlacements = async"), source.indexOf("// The system prompt a task is sent"));
    assert.equal(pass.match(/buildPlacementGazetteer\(/g)?.length, 1);
    assert.ok(pass.includes("gazetteer = buildPlacementGazetteer(await lazyLookupContext({ world }, { renderedRegions })(), world);"));
});

test("the placing pass tells the reader whose thing it is", () => {
    const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("const resolvePlacements = async"), source.indexOf("// The system prompt a task is sent"));
    assert.ok(body.includes("home: normalizeString(marker.ownerCode ?? op.ownerCode)"), "a structure's owner");
    assert.ok(body.includes("home: entry.owner || entry.home"), "a unit's owner, or the structure's");
});

// --- a town the map does not carry ---
//
// "Grand Forks, North Dakota": a real skip opened a depot there and lost it.
// The map had neither name; the game's list of the world's towns has the town.
// Here, a list of the wider world laid over the same small map:
//
//   Riverton      one town, in Westmark North
//   Springfield   three: one in each of Westmark's regions, one in Eastland North
//   Twinbridge    two, both in Westmark South
//   Farhaven      one, in Eastland South
//   Midburg       a namesake of the map's own Midburg, in Eastland North
//   Seaholm       one, out at sea
const WORLD = {
    riverton: [[31, 51.5]],
    springfield: [[30.5, 51], [33, 49], [36, 51]],
    twinbridge: [[31, 48.5], [33, 49.5]],
    farhaven: [[37, 49]],
    midburg: [[36.5, 51.5]],
    seaholm: [[40, 45]],
};
const asked = [];
const atlas = { ...gazetteer, worldCities: (name) => { asked.push(name); return WORLD[fold(name)] ?? []; } };
const placeWith = (phrase, options = {}) => resolvePlacement(phrase, atlas, options);

test("a town the map does not carry is taken from the world's list, when it is the one town of its name in the owner's land", () => {
    const depot = placeWith("Riverton", { home: "Westmark" });
    assert.deepEqual([depot.lng, depot.lat, depot.regionId, depot.how], [31, 51.5, "wm-n", "at"]);
    const unit = placeWith("Riverton, Nowhereshire", { owner: "Westmark" });
    assert.deepEqual([unit.lng, unit.lat], [31, 51.5], "an address whose place the map does not know is put to the same test");
    assert.deepEqual(placeWith("Riverton", { home: "Westmark" }), depot, "and it is the same point every time");
    // The same map with no list to ask, or with one that has not arrived: as before.
    assert.match(resolvePlacement("Riverton", gazetteer, { owner: "Westmark" }).error, /is called "Riverton"/);
    assert.match(resolvePlacement("Riverton", { ...gazetteer, worldCities: () => [] }, { owner: "Westmark" }).error, /is called "Riverton"/);
});

test("namesakes are refused, and the refusal says which regions the choice lies between", () => {
    const refused = placeWith("Springfield", { owner: "Westmark" });
    assert.equal(refused.error, '2 towns called Springfield lie in Westmark, in the regions Westmark North and Westmark South; name the region it is in, as "Springfield, <region>"');
    assert.deepEqual(refused.names, [], "no near miss on the map's own names is offered beside it");
    assert.match(placeWith("near Springfield", { owner: "Westmark" }).error, /^2 towns called Springfield lie in Westmark/, "whatever the grammar");
    // Two of the name in one region: naming the region will put it in that region, which is as near as a name gets.
    assert.equal(placeWith("Twinbridge", { owner: "Westmark" }).error, '2 towns called Twinbridge lie in Westmark, in the region Westmark South; name the region it is in, as "Twinbridge, <region>"');
    // Eastland has one Springfield: there it is no namesake.
    const theirs = placeWith("Springfield", { owner: "Eastland" });
    assert.deepEqual([theirs.lng, theirs.lat, theirs.regionId], [36, 51, "el-n"]);
});

test("a town across the border is refused: nothing crosses on a name's say-so", () => {
    const abroad = placeWith("Farhaven", { owner: "Westmark" });
    assert.equal(abroad.error, 'no town called Farhaven lies in Westmark: the one on this map is in the region Eastland South; name the region it is in, as "Farhaven, <region>"');
    assert.match(placeWith("near Farhaven, Nowhereshire", { owner: "Westmark" }).error, /^no town called Farhaven lies in Westmark/);
    assert.match(placeWith("Springfield, Nowhereshire", { home: "North Korea" }).error, /^no town called Springfield lies in North Korea: the 3 on this map are in the regions Westmark North, Westmark South and Eastland North;/);
    // With nobody's land to test it against it is not taken, and the list is not even asked.
    asked.length = 0;
    assert.match(placeWith("Farhaven").error, /is called "Farhaven"/);
    assert.match(placeWith("Riverton, Nowhereshire").error, /is called "Riverton, Nowhereshire"/);
    assert.deepEqual(asked, []);
    // Out at sea it is no town of this map.
    assert.match(placeWith("Seaholm", { owner: "Westmark" }).error, /is called "Seaholm"/);
});

test("an address whose place the map knows is respected", () => {
    // Of three Springfields, the one in the region named.
    const south = placeWith("Springfield, Westmark South", { owner: "Westmark" });
    assert.deepEqual([south.lng, south.lat, south.regionId], [33, 49, "wm-s"]);
    // The address says where, across a border too: this time the country was named.
    const east = placeWith("Springfield, Eastland", { owner: "Westmark" });
    assert.deepEqual([east.lng, east.lat], [36, 51]);
    const inner = placeWith("Springfield, Westmark North, Westmark", { owner: "Westmark" });
    assert.deepEqual([inner.lng, inner.lat], [30.5, 51], "inside every place the address names, not any one of them");
    // The map's only Midburg is in Westmark; the list has the one in Eastland.
    const namesake = placeWith("Midburg, Eastland", { owner: "Westmark" });
    assert.deepEqual([namesake.lng, namesake.lat], [36.5, 51.5]);
    // A town that is not where the address says: the place itself, as before.
    const elsewhere = placeWith("Farhaven, Westmark North", { owner: "Westmark" });
    assert.deepEqual([elsewhere.regionId, elsewhere.how], ["wm-n", "inside"]);
    // Two of the name in it: the place itself, and neither of them.
    const both = placeWith("Springfield, Westmark", { owner: "Westmark" });
    assert.equal(both.how, "inside");
    assert.ok(["wm-n", "wm-s"].includes(both.regionId), String(both.regionId));
    const twins = placeWith("Twinbridge, Westmark South", { owner: "Westmark" });
    assert.deepEqual([twins.regionId, twins.how], ["wm-s", "inside"]);
    // A place the map knows but cannot stand anything in (no shape): the address named it, so the
    // owner's own land is not what the refusal talks about.
    const shapeless = { ...atlas, find: (name, options) => (fold(name) === "ghostland" ? { kind: "region", name: "Ghostland", region: { id: "gh", name: "Ghostland", geometry: null } } : atlas.find(name, options)) };
    assert.match(resolvePlacement("Springfield, Ghostland", shapeless, { owner: "Westmark" }).error, /is called "Springfield, Ghostland"/);
});

test("grammar still applies to a town from the world's list", () => {
    const near = placeWith("near Riverton, Nowhereshire", { owner: "Westmark", seedText: "3rd Army" });
    assert.equal(near.how, "near");
    assert.equal(near.regionId, "wm-n");
    assert.ok(Math.abs(distanceKm([near.lng, near.lat], [31, 51.5]) - NEAR_KM) < 1, "beside it, not on it");
    assert.equal(placeWith("near Riverton", { owner: "Westmark" }).how, "near");
    assert.equal(placeWith("toward Riverton", { owner: "Westmark" }).how, "near", "an objective is beside the place");
    const east = placeWith("east of Riverton", { owner: "Westmark" });
    assert.ok(east.lng > 31 && Math.abs(distanceKm([east.lng, east.lat], [31, 51.5]) - DIRECTION_KM) < 1, JSON.stringify(east));
    // Grammar after a comma still means what it meant: the north of it, not a town in a place called North.
    const north = placeWith("Riverton, north", { owner: "Westmark" });
    assert.ok(north.lat > 51.7 && Math.abs(north.lng - 31) < 0.01, JSON.stringify(north));
});

test("the world's list is asked only about a place the map does not have", () => {
    asked.length = 0;
    const onTheMap = [
        "Midburg", "near Midburg", "east of Midburg", "Midburg, Westmark", "Midburg, Westmark North", "near Midburg, Westmark",
        "Westmark South", "northern Westmark", "northern border", "off Porthaven", "coast of Eastland", "between Midburg and Porthaven",
        "Westmark South facing Eastland", "[35.5, 49.5]", "1st Guards Army", "North Korea",
    ];
    for (const phrase of onTheMap) assert.equal(placeWith(phrase, { owner: "Westmark" }).error, undefined, phrase);
    assert.deepEqual(asked, [], "the list has a Midburg of its own, and is not asked for it");
    // What the map lacks is asked for by the spot alone, before settling for what the spot is in.
    assert.equal(placeWith("Fort Nowhere, Westmark North", { owner: "Westmark" }).regionId, "wm-n");
    assert.deepEqual(asked, ["Fort Nowhere"]);
    // A phrase the map could not place for another reason is still not the list's to answer: Midburg is on the map.
    asked.length = 0;
    assert.ok(placeWith("Midburg facing Atlantis", { owner: "Eastland" }).error);
    assert.deepEqual(asked, ["Midburg facing Atlantis"], "the whole phrase is no name the map has; Midburg is");
    // The same for an address, with a gazetteer that finds nothing loosely (the real one finds no "near Midburg").
    asked.length = 0;
    const exactOnly = { ...atlas, find: (name) => gazetteer.find(name, { exact: true }) };
    assert.equal(resolvePlacement("near Midburg, Westmark", exactOnly, { owner: "Westmark" }).error, undefined);
    assert.deepEqual(asked, ["near Midburg"]);
});

test("a gazetteer that throws on one of the list's towns costs that town, not the placement", () => {
    const brittle = { ...atlas, regionAt: (point) => { if (point[0] === 31 && point[1] === 51.5) throw new Error("bad polygon"); return atlas.regionAt(point); } };
    assert.match(resolvePlacement("Riverton", brittle, { owner: "Westmark" }).error, /is called "Riverton"/);
    const address = resolvePlacement("Riverton, Midburg", brittle, { owner: "Westmark" });
    assert.deepEqual([address.lng, address.lat], [32, 51], "and an address still falls back to what the spot is in");
});

test("the placing pass fetches the world's list only when a phrase has named a place the map does not have", () => {
    const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
    // The list is read in one place, and that place is reached one way: by a
    // pass that has a name left unanswered.
    assert.equal(source.match(/loadWorldCities\(\)/g)?.length, 1);
    assert.equal(source.match(/readWorldCities\(\)/g)?.length, 1);
    // The gazetteer answers from the list when it is here, and otherwise remembers that it was asked.
    const body = source.slice(source.indexOf("const buildPlacementGazetteer = "), source.indexOf("const resolvePlacements = async"));
    assert.ok(body.includes("if (worldCities) return worldCities.find(name);"));
    assert.ok(body.includes("unanswered = true;"));
    assert.ok(body.includes("if (!unanswered) return false;"), "a pass whose places the map all has fetches nothing");
    assert.ok(body.includes("if (!worldCities && !asked) {"), "and a pass asks at most once");
    assert.ok(body.includes("await readWorldCities();"));
    assert.ok(body.includes("worldCities: worldCitiesNamed, worldCitiesArrived };"));
    // The pass reads the phrase again once the list has arrived.
    const pass = source.slice(source.indexOf("const resolvePlacements = async"), source.indexOf("// The system prompt a task is sent"));
    assert.ok(pass.includes("if (byPhrase && await gazetteer.worldCitiesArrived()) byPhrase = readPhrase();"));
});
