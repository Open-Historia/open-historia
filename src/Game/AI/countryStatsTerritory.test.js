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

import { buildTargetStatsTerritorialBasisKernel } from "./countryStatsWorkerKernel.js";

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
  // Twelve whole one-region components outweigh the partial one and exceed the
  // ten-name cap; the partial one must still be listed, and first.
  const catalog = [
    ...Array.from({ length: 12 }, (_, index) => region(`w${index}`, `Isle ${String.fromCharCode(65 + index)}`)),
    ...regionsOf("Borduria", 10, "b"),
  ];
  const overrides = Object.fromEntries([
    ...Array.from({ length: 12 }, (_, index) => [`w${index}`, "Ruritania"]),
    ["b1", "Ruritania"],
  ]);
  const line = bucketLine((await basis(catalog, overrides)).context);
  assert.match(line, /representative places: Borduria \(PARTIAL: only 1 of its 10 regions/);
  assert.match(line, /and 3 more whole component\(s\)$/);
});

test("a large partial holding names a few regions and counts the rest", async () => {
  const catalog = [...regionsOf("Ruritania", 2, "r"), ...regionsOf("Borduria", 20, "b")];
  const overrides = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`b${index + 1}`, "Ruritania"]));
  const line = bucketLine((await basis(catalog, overrides)).context);
  assert.match(line, /Borduria \(PARTIAL: only 9 of its 20 regions — (Borduria b\d+, ){3}Borduria b\d+ and 5 more;/);
});
