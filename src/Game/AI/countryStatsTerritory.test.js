/*! Open Historia — country Stats territorial basis tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/countryStatsTerritory.test.js
//
// What the Stats model is told about a polity's territory. A field report's
// Russia came out at 188.8M people because this section said "representative
// places: Russia, Ukraine" for a Russia holding only Crimea — 16 of Ukraine's 144
// regions — and a centre of 0.0°N 0.0°E, because the map carries no coordinates
// and a missing one became zero.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTargetStatsTerritorialBasisKernel,
  geometryCentroid,
  projectCountryStatsScenarioCatalog,
} from "./countryStatsWorkerKernel.js";

// A map in the catalog shape the worker projects: `country` is the base
// geography each region originally belongs to.
const region = (id, country, extra = {}) => ({ id, name: `${country} ${id}`, country, countryCode: "", ...extra });
const regionsOf = (country, count, prefix) =>
  Array.from({ length: count }, (_, index) => region(`${prefix}${index + 1}`, country));

const basis = (catalog, overrides = {}, code = "Ruritania") =>
  buildTargetStatsTerritorialBasisKernel({
    bundle: { world: { regionOwnershipOverrides: overrides }, events: [], game: {} },
    code,
    scenarioCatalog: catalog,
  });

const bucketLine = (context) => context.split("\n").find((line) => line.startsWith("[M1]")) ?? "";

test("a component the polity holds only part of says so, with the regions it holds", async () => {
  // Ruritania holds all 5 of its own regions and 2 of Borduria's 10.
  const catalog = [...regionsOf("Ruritania", 5, "r"), ...regionsOf("Borduria", 10, "b")];
  const { context } = await basis(catalog, { b1: "Ruritania", b2: "Ruritania" });
  const line = bucketLine(context);

  assert.match(line, /Borduria \(PARTIAL: only 2 of its 10 regions — Borduria b1, Borduria b2; count ONLY these, not all of Borduria\)/);
  assert.match(line, /Ruritania \(whole, 5 regions\)/);
});

test("a polity holding only whole components has nothing marked partial", async () => {
  const { context } = await basis(regionsOf("Ruritania", 3, "r"));
  assert.doesNotMatch(bucketLine(context), /PARTIAL/);
  assert.match(bucketLine(context), /Ruritania \(whole, 3 regions\)/);
});

test("a partial component is never cut to make room for whole ones", async () => {
  // A polity too big to list every component (30 whole one-region isles) keeps
  // the ten-name sample; the partial one must still be listed, and first.
  const catalog = [
    ...Array.from({ length: 30 }, (_, index) => region(`w${index}`, `Isle ${index}`)),
    ...regionsOf("Borduria", 10, "b"),
  ];
  const overrides = Object.fromEntries([
    ...Array.from({ length: 30 }, (_, index) => [`w${index}`, "Ruritania"]),
    ["b1", "Ruritania"],
  ]);
  const { context, componentDetail } = await basis(catalog, overrides);
  assert.equal(componentDetail, false);
  const line = bucketLine(context);
  assert.match(line, /representative places: Borduria \(PARTIAL: only 1 of its 10 regions/);
  assert.match(line, /and 21 more whole component\(s\)$/);
});

test("a small polity lists every component with the id a split row answers with", async () => {
  const catalog = [...regionsOf("Ruritania", 5, "r"), ...regionsOf("Borduria", 10, "b"), region("i1", "Isle")];
  const { context, macroPlan, componentDetail } = await basis(catalog, { b1: "Ruritania", i1: "Ruritania" });
  assert.equal(componentDetail, true);
  // Partial first, then by weight; numbered in that order.
  assert.match(bucketLine(context), /; components: \[C1\] Borduria \(PARTIAL[^;]*; count ONLY these, not all of Borduria\); \[C2\] Ruritania \(whole, 5 regions\); \[C3\] Isle \(whole, 1 region\)$/);
  assert.deepEqual(
    macroPlan.flatMap((bucket) => bucket.members.map((member) => `${member.componentId}=${member.geography}`)),
    ["C1=Borduria", "C2=Ruritania", "C3=Isle"],
  );
});

test("a large partial holding names a few regions and counts the rest", async () => {
  const catalog = [...regionsOf("Ruritania", 2, "r"), ...regionsOf("Borduria", 20, "b")];
  const overrides = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`b${index + 1}`, "Ruritania"]));
  const line = bucketLine((await basis(catalog, overrides)).context);
  assert.match(line, /Borduria \(PARTIAL: only 9 of its 20 regions — (Borduria b\d+, ){3}Borduria b\d+ and 5 more;/);
});

// --- Where a bucket is -------------------------------------------------------

const square = (lng, lat, size = 1) => [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]];

test("a region's point comes from its shape: the centre of its largest part", () => {
  assert.deepEqual(geometryCentroid({ type: "Polygon", coordinates: square(10, 20, 2) }), { lng: 11, lat: 21 });
  // An archipelago region sits on its main island, not between the islands.
  const archipelago = { type: "MultiPolygon", coordinates: [square(0, 0, 0.1), square(50, 10, 4)] };
  assert.deepEqual(geometryCentroid(archipelago), { lng: 52, lat: 12 });
  assert.deepEqual(geometryCentroid({ type: "Point", coordinates: [3, 4] }), { lng: 3, lat: 4 });
  assert.equal(geometryCentroid(null), null);
  assert.equal(geometryCentroid({ type: "LineString", coordinates: [[0, 0], [1, 1]] }), null);
});

test("the worker's catalog takes a map point when there is one, the shape when there is not, and never invents 0,0", () => {
  const feature = (properties, geometry = null) => ({ type: "Feature", properties: { id: properties.id, name: properties.id, ...properties }, geometry });
  const [fromProps, fromShape, nothing] = projectCountryStatsScenarioCatalog({
    features: [
      feature({ id: "a", lng: 5, lat: 6 }, { type: "Polygon", coordinates: square(40, 40) }),
      feature({ id: "b" }, { type: "Polygon", coordinates: square(40, 40) }),
      feature({ id: "c", lng: null, lat: null }),
    ],
  });
  assert.deepEqual([fromProps.lng, fromProps.lat], [5, 6]);
  assert.deepEqual([fromShape.lng, fromShape.lat], [40.5, 40.5]);
  assert.deepEqual([nothing.lng, nothing.lat], [null, null]);
});

test("a bucket with no located component gets no centre, not 0.0°N 0.0°E", async () => {
  const { context } = await basis(regionsOf("Ruritania", 3, "r"));
  assert.doesNotMatch(bucketLine(context), /center/);
  assert.match(bucketLine(context), /^\[M1\] 1 live component\(s\); components: \[C1\] Ruritania/);
});

test("a bucket's centre is where its located regions are", async () => {
  const catalog = regionsOf("Ruritania", 3, "r").map((entry, index) => ({ ...entry, lng: 20 + index, lat: 50 }));
  assert.match(bucketLine((await basis(catalog)).context), /; center 50\.0°N, 21\.0°E;/);
});

test("with no points anywhere, many components are not split into buckets by list order", async () => {
  // Twelve separate one-region components and no coordinates: the stand-in
  // positions must not be clustered into arbitrary groups.
  const catalog = Array.from({ length: 12 }, (_, index) => region(`w${index}`, `Isle ${String.fromCharCode(65 + index)}`));
  const overrides = Object.fromEntries(catalog.map((entry) => [entry.id, "Ruritania"]));
  const { macroPlan } = await basis(catalog, overrides);
  assert.equal(macroPlan.length, 1);
});
