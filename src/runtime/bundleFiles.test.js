/*! Open Historia — zip-borne bundle assets © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/bundleFiles.test.js
//
// A scenario bundle inside a .zip carries its heavy assets as real entries
// instead of as strings inside scenario.json (bundleFiles.js). What matters is
// that the round trip is exact — an importer must not be able to tell — and
// that the small descriptors are left where they are.
import test from "node:test";
import assert from "node:assert/strict";

import { hasBundleFiles, restoreBundleFiles, splitBundleFiles } from "./bundleFiles.js";

// The browser globals the module needs. Node has Buffer; the game has atob/btoa.
globalThis.atob ??= (value) => Buffer.from(value, "base64").toString("binary");
globalThis.btoa ??= (value) => Buffer.from(value, "binary").toString("base64");

// A FeatureCollection big enough to be worth lifting (over 64 KB).
const geometry = {
    type: "FeatureCollection",
    features: Array.from({ length: 400 }, (_, index) => ({
        type: "Feature",
        properties: { id: String(index), owner: "Testland", name: `Region ${index}` },
        geometry: { type: "Polygon", coordinates: [[[index, 0], [index + 1, 0], [index + 1, 1], [index, 1], [index, 0]]] },
    })),
};
const archive = Uint8Array.from({ length: 200_000 }, (_, index) => index % 251);
const toBase64 = (bytes) => Buffer.from(bytes).toString("base64");

const bundle = () => ({
    schema: "pax-historia-scenario-bundle",
    assets: {
        // Small: stays inline.
        colors: { data: { Testland: [1, 2, 3] }, fileName: "colors.json", mode: "embedded" },
        // Absent: stays absent.
        flags: { fileName: "flags.json", mode: "default" },
        // JSON, and big.
        regionsGeojson: { contentType: "application/json", data: geometry, fileName: "regions.geojson", mode: "embedded" },
        // Binary, and big.
        regions: { contentType: "application/octet-stream", data: toBase64(archive), encoding: "base64", fileName: "regions.pmtiles", mode: "embedded" },
    },
    data: { world: { round: 3 } },
});

// What unzipBundle() hands back, over a plain { path: data } map.
const fakeZip = (files) => ({
    has: (path) => Object.hasOwn(files, path),
    names: () => Object.keys(files),
    text: async (path) => (typeof files[path] === "string" ? files[path] : Buffer.from(files[path]).toString("utf-8")),
    bytes: async (path) => (typeof files[path] === "string" ? new TextEncoder().encode(files[path]) : files[path]),
});

test("the heavy assets become files and the small ones stay in the document", () => {
    const { bundle: split, files } = splitBundleFiles(bundle());
    assert.deepEqual(Object.keys(files).sort(), ["assets/regions.geojson", "assets/regions.pmtiles"]);
    assert.deepEqual(split.assets.colors, bundle().assets.colors, "a handful of colours is not worth an entry");
    assert.deepEqual(split.assets.flags, bundle().assets.flags);
    assert.deepEqual(split.assets.regionsGeojson, {
        contentType: "application/json", file: "assets/regions.geojson", fileName: "regions.geojson", format: "json", mode: "file",
    });
    assert.equal(split.assets.regions.format, "base64");
    assert.equal(split.assets.regions.data, undefined, "the payload is in the zip now, not in both places");

    // The geometry goes in as text the zip can compress; the archive as bytes.
    assert.equal(typeof files["assets/regions.geojson"], "string");
    assert.deepEqual(JSON.parse(files["assets/regions.geojson"]), geometry);
    assert.ok(files["assets/regions.pmtiles"] instanceof Uint8Array);
    assert.deepEqual([...files["assets/regions.pmtiles"]], [...archive], "binary is lifted as bytes, not re-encoded");

    assert.equal(hasBundleFiles(split), true);
    assert.equal(hasBundleFiles(bundle()), false);
});

test("restoring gives back exactly the bundle that was split", async () => {
    const before = bundle();
    const { bundle: split, files } = splitBundleFiles(before);
    const restored = await restoreBundleFiles(split, fakeZip(files));
    assert.deepEqual(restored, before);
});

test("a bundle with nothing lifted, or read outside a zip, is left alone", async () => {
    const plain = bundle();
    assert.deepEqual(await restoreBundleFiles(plain, fakeZip({})), plain, "no pointers, nothing to do");
    assert.deepEqual(splitBundleFiles({ schema: "x" }), { bundle: { schema: "x" }, files: {} });
    assert.deepEqual(await restoreBundleFiles(plain, null), plain);
});

test("a pointer whose file is missing leaves an honest gap, not an empty map", async () => {
    const { bundle: split } = splitBundleFiles(bundle());
    const restored = await restoreBundleFiles(split, fakeZip({}));
    assert.deepEqual(restored.assets.regionsGeojson, {
        contentType: "application/json", fileName: "regions.geojson", mode: "default",
    });
    assert.equal(restored.assets.regions.mode, "default");
});
