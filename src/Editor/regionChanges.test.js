/*! Open Historia — what a map-editor save carries © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/regionChanges.test.js
//
// The editor sends only the regions that moved (regionChanges.js), and the store
// puts them back (server/regionDelta.js). These two halves have to agree exactly:
// a region that quietly fails to travel is a map the author loses. So the last
// test here plays a whole editing session against both of them at once.
import test from "node:test";
import assert from "node:assert/strict";

import { buildRegionChanges, hashRegionText, regionIdOf } from "./regionChanges.js";
import { applyRegionDelta } from "../../server/regionDelta.js";

// A written region, as OpenLayers hands one over: id on top, id in properties.
const region = (id, { owner = "Testland", name = `Region ${id}`, x = Number(id) } = {}) => ({
    type: "Feature",
    id: String(id),
    properties: { id: String(id), owner, name, typeId: "land" },
    geometry: { type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] },
});

const world = (ids) => ids.map((id) => region(id));
const marksFor = (features) => new Map(features.map((feature) => [regionIdOf(feature), hashRegionText(JSON.stringify(feature))]));

test("the first save carries the whole map, and the stamps for it", () => {
    const features = world([1, 2, 3]);
    const result = buildRegionChanges({ writtenFeatures: features, saved: new Map() });
    assert.equal(result.full, true);
    assert.deepEqual(result.features, features, "already written once — never twice");
    assert.deepEqual([...result.marks.keys()], ["1", "2", "3"]);
});

test("a save that follows an untouched map carries nothing at all", () => {
    const features = world([1, 2, 3]);
    const result = buildRegionChanges({ writtenFeatures: features, saved: marksFor(features) });
    assert.equal(result.full, false);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.removed, []);
    assert.equal(result.count, 3);
});

test("only what moved travels — including a rename, which moves nothing", () => {
    const before = world([1, 2, 3]);
    const saved = marksFor(before);

    const moved = [before[0], { ...before[1], geometry: { ...before[1].geometry, coordinates: [[[9, 9], [10, 9], [10, 10], [9, 9]]] } }, before[2]];
    const byGeometry = buildRegionChanges({ writtenFeatures: moved, saved });
    assert.deepEqual(byGeometry.changed.map(regionIdOf), ["2"]);

    const renamed = [before[0], before[1], { ...before[2], properties: { ...before[2].properties, name: "Renamed" } }];
    const byName = buildRegionChanges({ writtenFeatures: renamed, saved });
    assert.deepEqual(byName.changed.map(regionIdOf), ["3"], "a property is part of the region, so it travels too");

    const repainted = [{ ...before[0], properties: { ...before[0].properties, owner: "Otherland" } }, before[1], before[2]];
    assert.deepEqual(buildRegionChanges({ writtenFeatures: repainted, saved }).changed.map(regionIdOf), ["1"]);
});

test("a region that is gone is named, and a new one rides in changed", () => {
    const before = world([1, 2, 3]);
    const saved = marksFor(before);
    const after = [before[0], before[2], region(4)];
    const result = buildRegionChanges({ writtenFeatures: after, saved });
    assert.deepEqual(result.removed, ["2"]);
    assert.deepEqual(result.changed.map(regionIdOf), ["4"]);
    assert.equal(result.count, 3);
});

test("a region with no id makes the whole map travel, rather than travelling wrong", () => {
    const features = [region(1), { ...region(2), id: undefined, properties: { owner: "Testland" } }, region(3)];
    const result = buildRegionChanges({ writtenFeatures: features, saved: marksFor(world([1, 3])) });
    assert.equal(result.full, true);
    assert.equal(result.features, null, "the caller serialises it the old way");
    assert.equal(result.marks, null, "and the next save starts from nothing again");
});

// The whole point, end to end: an editing session where every save is a
// difference, and the stored map keeps up with the editor's exactly.
test("a session of edits leaves the store holding what the editor holds", () => {
    let stored = null;
    let saved = new Map();

    // Each save: build what travels, apply it to the store, then commit the marks
    // the way MapEditor does once the save has landed.
    const save = (features) => {
        const result = buildRegionChanges({ writtenFeatures: features, saved });
        if (result.full) {
            stored = { type: "FeatureCollection", features: result.features ?? features };
        } else {
            const merged = applyRegionDelta(stored, { changed: result.changed, count: result.count, removed: result.removed });
            assert.equal(merged.applied, true, merged.reason);
            stored = merged.regions;
        }
        saved = result.marks ?? new Map();
        return result;
    };

    const start = world([1, 2, 3, 4]);
    save(start);
    assert.deepEqual(stored.features, start);

    // Draw over one border.
    const carved = [...start];
    carved[1] = { ...carved[1], geometry: { type: "Polygon", coordinates: [[[2, 0], [2.5, 0], [2.5, 1], [2, 1], [2, 0]]] } };
    const first = save(carved);
    assert.deepEqual(first.changed.map(regionIdOf), ["2"], "one region on the wire, not four");
    assert.deepEqual(stored.features, carved);

    // Paint an owner, delete a region, add one.
    const reshaped = [
        { ...carved[0], properties: { ...carved[0].properties, owner: "Otherland" } },
        carved[1],
        carved[3],
        region(5),
    ];
    const second = save(reshaped);
    assert.deepEqual(second.changed.map(regionIdOf), ["1", "5"]);
    assert.deepEqual(second.removed, ["3"]);
    assert.deepEqual(stored.features.map(regionIdOf), ["1", "2", "4", "5"], "order is kept, the new one goes last");
    assert.deepEqual(stored.features, [reshaped[0], reshaped[1], reshaped[2], reshaped[3]]);

    // And a save with nothing to say changes nothing.
    const quiet = save(reshaped);
    assert.deepEqual(quiet.changed, []);
    assert.deepEqual(stored.features.map(regionIdOf), ["1", "2", "4", "5"]);
});
