/*! Open Historia — placement: a name said with its kind, and an address read outward: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/placementKinds.test.js
//
// Runs without node_modules: placement.js and nameRefs.js import nothing else.
//
// Seen in a 45-skip test (2026-10-09): a division ordered home to "Fort
// Stewart, Georgia, United States" was marched to the Caucasus. The map had no
// American state called Georgia (its regions there are named for cities), so
// the Georgia of the address was the only Georgia the map knew: the country.

import test from "node:test";
import assert from "node:assert/strict";

import { pointInGeometry, resolvePlacement, resolveRegionPlacement } from "./placement.js";

const fold = (value) => String(value ?? "").trim().toLowerCase();
const box = (west, south, size = 4) => ({ type: "Polygon", coordinates: [[[west, south], [west + size, south], [west + size, south + size], [west, south + size], [west, south]]] });

// A gazetteer that answers the way gameplay.js's does: a country before a
// region of the same name; a name asked for as one kind is that kind or
// nothing; a tagged name given with a country is in that country or nowhere.
const mapOf = (regions) => {
    const asked = [];
    const regionAt = (point) => regions.find((row) => pointInGeometry(point, row.geometry)) ?? null;
    const find = (name, { country = "", kind = "" } = {}) => {
        asked.push({ name, kind, country });
        const key = fold(name);
        const polity = () => {
            const held = regions.filter((row) => fold(row.owner) === key);
            return held.length ? { kind: "polity", name: held[0].owner, regions: held } : null;
        };
        const region = () => {
            const named = regions.filter((row) => fold(row.name) === key);
            const inCountry = named.filter((row) => fold(row.owner) === fold(country));
            const hit = country ? (inCountry[0] ?? (kind ? null : named[0])) : named[0];
            return hit ? { kind: "region", name: hit.name, region: hit } : null;
        };
        if (kind === "country") return polity();
        if (kind === "region") return region();
        if (kind) return null;
        return (country ? region() : null) ?? polity() ?? region();
    };
    return { find, regionAt, asked, findRegionId: (id) => regions.find((row) => row.id === id) ?? null };
};

// The map of the test that found it: no American Georgia.
const CITY_NAMED = () => mapOf([
    { id: "us-atl", name: "Atlanta", owner: "United States", geometry: box(-86, 31) },
    { id: "us-tx", name: "Texas", owner: "United States", geometry: box(-102, 28) },
    { id: "ge-1", name: "Tbilisi", owner: "Georgia", geometry: box(42, 40) },
]);
// A map that has both Georgias.
const BOTH = () => mapOf([
    { id: "us-ga", name: "Georgia", owner: "United States", geometry: box(-86, 31) },
    { id: "us-tx", name: "Texas", owner: "United States", geometry: box(-102, 28) },
    { id: "ge-1", name: "Tbilisi", owner: "Georgia", geometry: box(42, 40) },
]);

const ownerAt = (map, placed) => map.regionAt([placed.lng, placed.lat])?.owner;

test("an address is read outward: a part counts only where the rest says it is", () => {
    const map = CITY_NAMED();
    const placed = resolvePlacement("Fort Stewart, Georgia, United States", map, { owner: "United States", seedText: "3rd Infantry Division" });
    assert.equal(placed.error, undefined);
    assert.equal(ownerAt(map, placed), "United States", "not the country of Georgia, which is not in the United States");
    assert.notEqual(placed.regionId, "ge-1");
});

test("an address whose parts do agree is still placed in the innermost of them", () => {
    const map = BOTH();
    const placed = resolvePlacement("Fort Stewart, Georgia, United States", map, { owner: "United States" });
    assert.equal(placed.regionId, "us-ga");
    // And a country alone is still the country.
    assert.equal(resolvePlacement("Georgia", map).regionId, "ge-1");
});

test("a name said with its kind is looked up as that kind and no other", () => {
    const map = BOTH();
    const state = resolvePlacement("region: Georgia, country: United States", map);
    assert.equal(state.regionId, "us-ga");
    assert.ok(map.asked.some((entry) => entry.name === "Georgia" && entry.kind === "region"), "the gazetteer is told the kind");
    assert.ok(map.asked.some((entry) => entry.name === "United States" && entry.kind === "country"));

    assert.equal(resolvePlacement("country: Georgia", map).regionId, "ge-1");
    assert.equal(resolvePlacement("region: Georgia", map).regionId, "us-ga", "a region of that name, never the country");
    assert.equal(resolvePlacement("near region: Georgia, country: United States", map).regionId, "us-ga", "the grammar reads on with the tags gone");
});

test("a tagged name the map lacks falls back on what it is in, never on a namesake of another kind", () => {
    const map = CITY_NAMED();
    const placed = resolvePlacement("Fort Stewart, region: Georgia, country: United States", map, { owner: "United States" });
    assert.equal(placed.error, undefined);
    assert.equal(ownerAt(map, placed), "United States");
    // Asked for by itself, a region the map does not have is not found, and is not the country.
    assert.ok(resolvePlacement("region: Georgia", map).error);
    assert.equal(resolvePlacement("country: Georgia", map).regionId, "ge-1");
});

test("a part of a phrase that is a phrase of its own places the thing when the rest names nothing", () => {
    // Seen in the same test: a carrier group sent to "South Sea, west of the
    // Philippines" went to the Philippine Sea, on the far side of the islands.
    const map = mapOf([{ id: "ph-1", name: "Luzon", owner: "Philippines", geometry: box(120, 14) }]);
    const placed = resolvePlacement("South Sea, west of the Philippines", map, { owner: "United States", seedText: "Carrier Strike Group 5" });
    assert.equal(placed.error, undefined);
    assert.equal(placed.regionId, "ph-1");
    assert.ok(placed.lng < 122, `the western half of it, got ${placed.lng}`);
    // A part that is only a name is not tried by itself: nothing is guessed from half an address.
    assert.ok(resolvePlacement("Nowhere, Luzon", { ...map, find: (name, options) => (fold(name) === "luzon" ? null : map.find(name, options)) }).error);
});

test("a region given in place of a phrase is read by its name, with or without what stood round it", () => {
    const map = mapOf([{ id: "4441", name: "Hamhung", owner: "North Korea", geometry: box(127, 39) }]);
    for (const written of ["Hamhung", "region: Hamhung", "Hamhung (4441)", "region: Hamhung (4441)", "4441"]) {
        const placed = resolveRegionPlacement(written, map, { seedText: "u-1" });
        assert.equal(placed.error, undefined, written);
        assert.equal(placed.regionId, "4441", written);
    }
    assert.match(resolveRegionPlacement("region: Wonsan", map).error, /no region on this map is called "Wonsan"/);
});
