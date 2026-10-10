import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENT_PLACES_RULE, findEventPlace, findEventPlaces, readEventPlace } from "./eventPlaces.js";
import { MAX_EVENT_PLACES, normalizeEventPlaces } from "../../runtime/eventPlaces.js";
import { readNameRef, stripKindTags } from "./nameRefs.js";

test("\"building:\" is a structure, wherever a kind is read", () => {
    assert.deepEqual(readNameRef("building: Camp Humphreys"), { kind: "structure", name: "Camp Humphreys", bracket: "", written: "building: Camp Humphreys" });
    assert.equal(readNameRef("Building: Camp Humphreys").kind, "structure");
    const phrase = stripKindTags("near building: Camp Humphreys, country: South Korea");
    assert.equal(phrase.text, "near Camp Humphreys, South Korea");
    assert.equal(phrase.kinds.get("camp humphreys"), "structure");
});

test("an entry is read as a name, its kind and the country it was said to be in", () => {
    assert.deepEqual(readEventPlace("city: Kharkiv, country: Ukraine"), { kind: "city", name: "Kharkiv", country: "Ukraine" });
    assert.deepEqual(readEventPlace("City: Kharkiv, Ukraine"), { kind: "city", name: "Kharkiv", country: "Ukraine" });
    assert.deepEqual(readEventPlace("region: Crimea"), { kind: "region", name: "Crimea", country: "" });
    assert.deepEqual(readEventPlace("country: the United States"), { kind: "country", name: "United States", country: "" });
    assert.deepEqual(readEventPlace("building: Camp Humphreys"), { kind: "structure", name: "Camp Humphreys", country: "" });
    assert.deepEqual(readEventPlace("structure: Camp Humphreys"), { kind: "structure", name: "Camp Humphreys", country: "" });
    assert.deepEqual(readEventPlace("sea: Black Sea"), { kind: "sea", name: "Black Sea", country: "" });
    assert.deepEqual(readEventPlace("unit: 3rd Infantry Division"), { kind: "unit", name: "3rd Infantry Division", country: "" });
});

test("a name with no kind is no place, and neither is a kind that is no place", () => {
    for (const written of ["Salmon", "salmon", "Kharkiv, Ukraine", "the salmon run", "group: Free Cells", "tag: salmon", "", null, 7]) {
        assert.equal(readEventPlace(written), null, String(written));
    }
});

// A gazetteer in small: the map's own, as gameplay.js builds it, answers
// `find(name, { kind, country })` with one kind of thing and no other.
const square = (west, south) => ({ type: "Polygon", coordinates: [[[west, south], [west + 2, south], [west + 2, south + 2], [west, south + 2], [west, south]]] });
const MAP = {
    cities: [{ name: "Kharkiv", country: "Ukraine", point: [36.23, 49.99] }, { name: "Salmon Arm", country: "Canada", point: [-119.27, 50.7] }],
    regions: [{ id: "3301", name: "Salmon", country: "United States", geometry: square(-115, 44) }, { id: "4441", name: "Crimea", country: "Russia", geometry: square(33, 44) }],
    countries: { Ukraine: [{ id: "u1", geometry: square(30, 48) }], Greenland: [{ id: "g1", geometry: square(-50, 64) }, { id: "g2", geometry: square(-40, 70) }] },
    markers: [{ name: "Camp Humphreys", point: [127.03, 36.96] }],
    units: [{ name: "3rd Infantry Division", point: [129.2, 35.4] }],
    seas: [{ name: "Black Sea", point: [34, 43.2] }],
};
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const gazetteer = {
    find: (name, { kind = "", country = "" } = {}) => {
        if (kind === "city") {
            const city = MAP.cities.find((entry) => same(entry.name, name) && (!country || same(entry.country, country)));
            return city ? { kind: "city", name: city.name, point: city.point } : null;
        }
        if (kind === "region") {
            const region = MAP.regions.find((entry) => same(entry.name, name) && (!country || same(entry.country, country)));
            if (region) return { kind: "region", name: region.name, region };
            const area = Object.keys(MAP.countries).find((entry) => same(entry, name));
            return area === "Greenland" ? { kind: "polity", name: area, regions: MAP.countries[area] } : null;
        }
        if (kind === "country") {
            const found = Object.keys(MAP.countries).find((entry) => same(entry, name));
            return found ? { kind: "polity", name: found, regions: MAP.countries[found] } : null;
        }
        if (kind === "structure") {
            const marker = MAP.markers.find((entry) => same(entry.name, name));
            return marker ? { kind: "marker", name: marker.name, point: marker.point } : null;
        }
        if (kind === "unit") {
            const unit = MAP.units.find((entry) => same(entry.name, name));
            return unit ? { kind: "unit", name: unit.name, point: unit.point } : null;
        }
        throw new Error(`asked for "${name}" with no kind: nothing may be looked up that way`);
    },
    seaPoint: (name) => MAP.seas.find((entry) => same(entry.name, name)) ?? null,
};
const find = (written, options) => findEventPlace(readEventPlace(written), gazetteer, options);

test("each kind is found as that kind, with what the card needs to fly there", () => {
    assert.deepEqual(find("city: Kharkiv, country: Ukraine"), { kind: "city", name: "Kharkiv", lng: 36.23, lat: 49.99 });
    assert.deepEqual(find("region: Crimea"), { kind: "region", name: "Crimea", regionId: "4441" });
    assert.deepEqual(find("country: Ukraine"), { kind: "country", name: "Ukraine", lng: 31, lat: 49 });
    assert.deepEqual(find("building: Camp Humphreys"), { kind: "structure", name: "Camp Humphreys", lng: 127.03, lat: 36.96 });
    assert.deepEqual(find("unit: 3rd Infantry Division"), { kind: "unit", name: "3rd Infantry Division", lng: 129.2, lat: 35.4 });
    assert.deepEqual(find("sea: Black Sea"), { kind: "sea", name: "Black Sea", lng: 34, lat: 43.2 });
});

test("a city is a city or nothing, and in the country it was said to be in or nowhere", () => {
    // The region called Salmon is no city, and the city of Salmon Arm is not "Salmon".
    assert.equal(find("city: Salmon"), null);
    assert.equal(find("city: Kharkiv, country: Poland"), null);
    assert.equal(find("building: Kharkiv"), null);
    assert.equal(find("region: Kharkiv"), null);
    assert.equal(find("sea: Sea of Tranquility"), null);
    assert.equal(find("country: Atlantis"), null);
});

test("a territory is found as the land that belongs to it", () => {
    assert.deepEqual(find("country: Greenland"), { kind: "country", name: "Greenland", lng: -44, lat: 68 });
    assert.deepEqual(find("region: Greenland"), { kind: "country", name: "Greenland", lng: -44, lat: 68 });
});

test("what the event itself builds, raises or moves is where the event puts it", () => {
    const impacts = {
        markerOps: [{ op: "build", marker: { name: "Fort Resolute", lng: 10.5, lat: 50.5 } }],
        unitOps: [
            { op: "spawn", unit: { name: "9th Brigade", lng: 11, lat: 51 } },
            { op: "move", unitId: "u-3", toLng: 38.98, toLat: 35.78 },
        ],
    };
    const units = [{ id: "u-3", name: "3rd Infantry Division" }];
    assert.deepEqual(find("building: Fort Resolute", { impacts, units }), { kind: "structure", name: "Fort Resolute", lng: 10.5, lat: 50.5 });
    assert.deepEqual(find("unit: 9th Brigade", { impacts, units }), { kind: "unit", name: "9th Brigade", lng: 11, lat: 51 });
    // Where it is going in this event, not where it stood before it.
    assert.deepEqual(find("unit: 3rd Infantry Division", { impacts, units }), { kind: "unit", name: "3rd Infantry Division", lng: 38.98, lat: 35.78 });
});

test("an event's list keeps what was found and drops the rest without a word", () => {
    const found = findEventPlaces(["Salmon", "city: Kharkiv, country: Ukraine", "city: Atlantis", "region: Crimea", 12, null], gazetteer);
    assert.deepEqual(found.map((place) => `${place.kind}:${place.name}`), ["city:Kharkiv", "region:Crimea"]);
    // Read a second time (a turn validated twice), a found place is kept as it is.
    assert.deepEqual(findEventPlaces(found, null), found);
    assert.deepEqual(findEventPlaces("city: Kharkiv", gazetteer), []);
});

test("what is kept on an event is found places only, at most four, none twice", () => {
    const kept = normalizeEventPlaces([
        "city: Kharkiv, country: Ukraine",
        { kind: "city", name: "Kharkiv", lng: 36.23, lat: 49.99 },
        { kind: "city", name: "kharkiv", lng: 36.23, lat: 49.99 },
        { kind: "city", name: "Nowhere" },
        { kind: "city", name: "Null Island", lng: 0, lat: 0 },
        { kind: "region", name: "Crimea" },
        { kind: "region", name: "Crimea", regionId: "4441" },
        { kind: "country", name: "Ukraine" },
        { kind: "salmon", name: "Salmon", lng: 1, lat: 1 },
        { kind: "sea", name: "Black Sea", lng: 34, lat: 43.2 },
        { kind: "unit", name: "9th Brigade", lng: 11, lat: 51 },
    ]);
    assert.deepEqual(kept, [
        { kind: "city", name: "Kharkiv", lng: 36.23, lat: 49.99 },
        { kind: "region", name: "Crimea", regionId: "4441" },
        { kind: "country", name: "Ukraine" },
        { kind: "sea", name: "Black Sea", lng: 34, lat: 43.2 },
    ]);
    assert.equal(kept.length, MAX_EVENT_PLACES);
    assert.deepEqual(normalizeEventPlaces(undefined), []);
    assert.deepEqual(normalizeEventPlaces("city: Kharkiv"), []);
});

test("the rule the skip is given says a kind is needed and what is never listed", () => {
    assert.match(EVENT_PLACES_RULE, /each with its kind/);
    assert.match(EVENT_PLACES_RULE, /"building: Camp Humphreys"/);
    assert.match(EVENT_PLACES_RULE, /a thing that is not a place on the map .* is never listed/);
});
