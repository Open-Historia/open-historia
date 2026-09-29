/*! Open Historia — how much land a target's dossier says it holds © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/targetDossier.test.js
//
// The dossier is the one line about a polity's territory that intelligence
// briefings, spy intercepts and repairs are given. It used to count only
// regionOwnershipOverrides, so on a map where most regions keep their base owner
// one annexation left France "holding no regions", the annexer holding only what
// it took, and with no override at all every polity "held its modern-day
// territory", even in 1871.

import test from "node:test";
import assert from "node:assert/strict";

import { buildTargetDossierKernel } from "./countryStatsWorkerKernel.js";

const region = (id, country) => ({ id, name: `${country} ${id}`, country, countryCode: "" });
const CATALOG = [
  region("f1", "France"), region("f2", "France"), region("f3", "France"),
  region("g1", "German Empire"), region("g2", "German Empire"),
];

const dossier = (code, world = {}, catalog = CATALOG) =>
  buildTargetDossierKernel({ bundle: { world }, code, scenarioCatalog: catalog });
const territoryLines = (text) => text.split("\n").filter((line) => !line.startsWith("Deployed forces"));

test("with no changes recorded, each polity holds its starting regions, and nobody's map is 'modern-day'", () => {
  const text = dossier("France");
  assert.match(text, /Territory: holds 3 regions on the current map, and is their lawful sovereign\./);
  assert.doesNotMatch(text, /modern-day/);
  assert.doesNotMatch(text, /beyond its starting territory|held by others/);
});

test("one annexation elsewhere leaves everybody else's land where it was", () => {
  const world = { regionOwnershipOverrides: { g1: "France" } };
  const france = dossier("France", world);
  assert.match(france, /holds 4 regions/);
  assert.match(france, /Held beyond its starting territory in this scenario: 1 region: German Empire g1 \(German Empire\)/);
  const germany = dossier("German Empire", world);
  assert.match(germany, /holds 1 region/);
  assert.match(germany, /Of its starting territory in this scenario, 1 region is now held by others\./);
});

test("an occupation is held, but its lawful sovereign keeps the title", () => {
  const world = { regionOwnershipOverrides: { f1: "German Empire" }, regionSovereigntyOverrides: { f1: "France" } };
  assert.match(dossier("France", world), /holds 2 regions on the current map, and is the lawful sovereign of 3\./);
  assert.match(dossier("German Empire", world), /holds 3 regions on the current map, and is the lawful sovereign of 2\./);
});

test("a polity with no land says so", () => {
  assert.deepEqual(territoryLines(dossier("Kingdom of Aurelia")), ["Territory: holds no regions on the current map."]);
});

test("names are exact: a near-miss is a different polity", () => {
  const catalog = [region("r1", "Russian Federation")];
  assert.match(dossier("Russian Federation", {}, catalog), /holds 1 region/);
  assert.match(dossier("Russia", {}, catalog), /holds no regions/);
});

test("without a catalog it counts only what changed, and says so", () => {
  const text = dossier("France", { regionOwnershipOverrides: { g1: "France" } }, []);
  assert.match(text, /holds at least 1 region \(the region catalog was unavailable/);
  assert.match(dossier("France", {}, []), /could not be counted/);
});

test("the fallback catalog is used when there is no rendered scenario catalog", () => {
  const text = buildTargetDossierKernel({ bundle: { world: {} }, code: "France", scenarioCatalog: [], fallbackCatalog: CATALOG });
  assert.match(text, /holds 3 regions/);
});
