/*! Open Historia — how each war ended, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/warEndings.test.js

import assert from "node:assert/strict";
import test from "node:test";

import {
  NEITHER_LOST,
  divideLand,
  normalizeWarOutcome,
  outcomeSideOf,
  readWarEndings,
  recordWarEndings,
  warOutcomeChoices,
  warsAwaitingOutcome,
} from "./warEndings.js";
import { normalizeWarRecord } from "./warRecord.js";
import { buildLookupContext } from "../Game/AI/lookupTools.js";

// Issue #1000's save, cut down: the German Reich's wars all ended on its surrender, none with an outcome.
const world = {
  polityOverrides: { "German Reich": { status: "active" }, Yugoslavia: { status: "active" } },
  wars: [
    { id: "war-poland", title: "German Reich–Poland War", status: "ended", sideA: ["German Reich"], sideB: ["Poland", "Romania"], endedDate: "1945-05-08", note: "German unconditional surrender" },
    { id: "war-ussr", title: "Operation Barbarossa", status: "ended", sideA: ["German Reich"], sideB: ["Soviet Union"], endedDate: "1945-05-08" },
    { id: "war-ethiopia", title: "Second Italo-Ethiopian War", status: "ended", sideA: ["Italy"], sideB: ["Ethiopia"], endedDate: "1943-11-05" },
    { id: "war-live", title: "Korean War", status: "active", sideA: ["North Korea"], sideB: ["South Korea"] },
    { id: "war-told", title: "Old War", status: "ended", sideA: ["France"], sideB: ["Spain"], endedDate: "1946-01-01", outcome: { lost: ["Spain"] } },
    { id: "war-gone", title: "Lost Cause", status: "ended", sideA: ["Ruritania"], sideB: ["Yugoslavia"], endedDate: "1946-02-01" },
  ],
};
world.polityOverrides.Ruritania = { status: "dissolved" };

test("the ended wars with no outcome are asked, the latest ended first; live, told or one-sided ones are not", () => {
  const entries = warsAwaitingOutcome(world);
  assert.deepEqual(entries.map((entry) => [entry.key, entry.id]), [["w1", "war-poland"], ["w2", "war-ussr"], ["w3", "war-ethiopia"]]);
  assert.equal(warsAwaitingOutcome(world, { most: 1 }).length, 1);
});

test("each war's choices: a side lost, a lone state lost and was dissolved, or neither", () => {
  const [poland] = warsAwaitingOutcome(world);
  assert.deepEqual(warOutcomeChoices(poland), [
    "German Reich lost at the end",
    "German Reich lost at the end; its government was dissolved",
    "Poland, Romania lost at the end",
    NEITHER_LOST,
  ], "a side of two is never dissolved whole");
});

test("the answer is read by its choices and the map's names, and anything else is left out", () => {
  const entries = warsAwaitingOutcome(world);
  const polities = new Map(["German Reich", "Poland", "Romania", "Soviet Union", "United States", "United Kingdom", "French Republic", "Italy", "Ethiopia"].map((name) => [name.toLowerCase(), name]));
  const knownPolity = (name) => polities.get(String(name).trim().toLowerCase()) || "";
  const read = readWarEndings([
    { w1: { outcome: "German Reich lost at the end; its government was dissolved", landTo: "United States, united kingdom; French Republic, Soviet Union, Atlantis, German Reich" } },
    { w2: { outcome: "german reich lost at the end", landTo: "Soviet Union" }, w3: "neither side lost", w9: { outcome: "x" }, w1: { outcome: "Poland, Romania lost at the end" } },
  ], entries, { knownPolity });
  assert.deepEqual(read, [
    { warId: "war-poland", lost: ["German Reich"], won: ["Poland", "Romania"], dissolved: "German Reich", landTo: ["United States", "United Kingdom", "French Republic", "Soviet Union"] },
    { warId: "war-ussr", lost: ["German Reich"], won: ["Soviet Union"], dissolved: "", landTo: [] },
    { warId: "war-ethiopia", lost: [], won: [], dissolved: "", landTo: [] },
  ], "a name not on the map, the dissolved state itself, an unknown key and a second answer for a war are let go; landTo counts only with a dissolution");
  assert.deepEqual(readWarEndings({ w1: { outcome: "Germany won" } }, entries, { knownPolity }), [], "outside the closed set: nothing");
});

test("recorded, an outcome stays on the war through the ledger's own normaliser; a live war keeps none", () => {
  const entries = warsAwaitingOutcome(world);
  const read = readWarEndings({ w1: { outcome: "German Reich lost at the end; its government was dissolved", landTo: "" }, w3: { outcome: NEITHER_LOST, landTo: "" } }, entries);
  const wars = recordWarEndings(world.wars, read, { date: "1947-02-07" });
  const poland = normalizeWarRecord(wars.find((war) => war.id === "war-poland"));
  assert.deepEqual(poland.outcome, { lost: ["German Reich"], dissolved: ["German Reich"], date: "1947-02-07" });
  assert.deepEqual(normalizeWarRecord(wars.find((war) => war.id === "war-ethiopia")).outcome, { lost: [], dissolved: [], date: "1947-02-07" });
  assert.equal(normalizeWarRecord({ ...poland, status: "active" }).outcome, undefined);
  assert.equal(recordWarEndings(world.wars, []), world.wars);
  assert.equal(outcomeSideOf(poland, "German Reich"), "lost");
  assert.equal(outcomeSideOf(poland, "Romania"), "won");
  assert.equal(outcomeSideOf(poland, "Japan"), "");
  assert.deepEqual(normalizeWarOutcome({ lost: ["A"], dissolved: ["B"] }), { lost: ["A"], dissolved: [] }, "only a loser is dissolved");
  // A recorded war is not asked again.
  assert.deepEqual(warsAwaitingOutcome({ ...world, wars }).map((entry) => entry.id), ["war-ussr"]);
});

test("a dissolved state's land goes, region by region, to the heir standing nearest it", () => {
  const land = [
    { id: "west", centroid: [7, 51] },
    { id: "east", centroid: [13, 52] },
    { id: "nowhere" },
  ];
  const held = { "United Kingdom": [[-1, 52]], "Soviet Union": [[21, 52], [30, 55]], Atlantis: [] };
  const shares = divideLand(land, ["United Kingdom", "Soviet Union", "Atlantis"], (name) => held[name]);
  assert.equal(shares.get("west"), "United Kingdom");
  assert.equal(shares.get("east"), "Soviet Union");
  assert.equal(shares.get("nowhere"), "United Kingdom", "a region with no position goes to the first heir that stands somewhere");
  assert.equal(divideLand(land, ["Atlantis"], () => []).get("east"), "Atlantis", "no heir holds anything: the first takes it all");
  assert.equal(divideLand(land, [], () => []).size, 0);
  // Shares: four powers, eight regions, two each, though two of the powers stand far away.
  const germany = Array.from({ length: 8 }, (_, index) => ({ id: `de${index}`, centroid: [6 + index, 51] }));
  const zones = divideLand(germany, ["United States", "United Kingdom", "French Republic", "Soviet Union"], (name) => ({
    "United States": [[-75, 40]], "United Kingdom": [[-1, 52]], "French Republic": [[2, 47]], "Soviet Union": [[24, 53]],
  })[name]);
  const counts = {};
  for (const heir of zones.values()) counts[heir] = (counts[heir] ?? 0) + 1;
  assert.deepEqual(counts, { "United States": 2, "United Kingdom": 2, "French Republic": 2, "Soviet Union": 2 });
  assert.equal(zones.get("de7"), "Soviet Union", "the easternmost to the power in the east");
  // The short way round: a region at 179° E is nearer an heir at 179° W than one at 150° E.
  assert.equal(divideLand([{ id: "fiji", centroid: [179, -17] }], ["West", "East"], (name) => (name === "West" ? [[150, -17]] : [[-179, -17]])).get("fiji"), "East");
});

// Issue #1000's save, offline: Germany's land all went to the United States, because Alaska crosses the
// antimeridian and the middle of its box was longitude 0. The map's rows are placed by their own longitudes.
test("a region across the antimeridian is placed on its side of the world, not in the middle of it", () => {
  const alaska = {
    id: "USA.2_1",
    name: "Alaska",
    country: "United States",
    geometry: { type: "MultiPolygon", coordinates: [[[[-170, 60], [-141, 60], [-141, 70], [-170, 70], [-170, 60]]], [[[172, 52], [179.9, 52], [179.9, 53], [172, 53], [172, 52]]]] },
  };
  const bavaria = { id: "DEU.2_1", name: "Bayern", country: "Germany", geometry: { type: "Polygon", coordinates: [[[9, 47], [13.8, 47], [13.8, 50.5], [9, 50.5], [9, 47]]] } };
  const context = buildLookupContext({ regions: [alaska, bavaria], world: {} });
  const [lng] = context.ownerRows.get("United States")[0].centroid;
  assert.ok(lng < -150 || lng > 150, `Alaska placed at ${lng}`);
  assert.deepEqual(context.ownerRows.get("Germany")[0].centroid, [11.4, 48.75]);
});
