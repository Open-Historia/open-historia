/*! Open Historia — occupations settled after their war, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/occupationSettlements.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { applyOccupationSettlements, occupationAnswerPolity, occupationOutcomesFor, planOccupationSettlements, readOccupationAnswers, readOccupationSettlements } from "./occupationSettlements.js";

test("an answer of keys is read key by key, segments' answers together, and anything else is not a key", () => {
  assert.deepEqual(readOccupationAnswers({ o1: "Poland", o2: " Soviet Union ", note: "x", o3: "" }), [{ key: "o1", to: "Poland" }, { key: "o2", to: "Soviet Union" }]);
  assert.deepEqual(readOccupationAnswers([{ o1: "Poland" }, "a line", { O2: "Soviet Union" }]), [{ key: "o1", to: "Poland" }, { key: "o2", to: "Soviet Union" }]);
  assert.deepEqual(readOccupationAnswers(""), []);
});

test("a key's answer, returned or kept, names the group's sovereign or occupier; a polity's name stands as written", () => {
  const group = { controller: "German Reich", sovereign: "Poland" };
  assert.equal(occupationAnswerPolity("returned", group), "Poland");
  assert.equal(occupationAnswerPolity(" Kept ", group), "German Reich");
  assert.equal(occupationAnswerPolity("Soviet Union", group), "Soviet Union");
  // With its war on the ledger, the key says who lost it.
  const fought = { ...group, war: { title: "Polish War", ended: "1945-05-08" } };
  assert.deepEqual(occupationOutcomesFor(fought), ["Poland lost at the end", "German Reich lost at the end"]);
  assert.deepEqual(occupationOutcomesFor(group), ["returned", "kept"]);
  assert.equal(occupationAnswerPolity("German Reich lost at the end", fought), "Poland");
  assert.equal(occupationAnswerPolity("poland lost at the end", fought), "German Reich");
});

// Issue #1000's save, cut down: Poland still under the German Reich after its surrender, one region under the Soviets.
const pending = [
  { regionId: "POL.9_1", name: "Mazowieckie", controller: "German Reich", sovereign: "Poland" },
  { regionId: "POL.4_1", name: "Lubelskie", controller: "German Reich", sovereign: "Poland" },
  { regionId: "UKR.7_1", name: "Ivano-Frankivs'k", controller: "German Reich", sovereign: "Poland" },
  { regionId: "UKR.19_1", name: "Rivne", controller: "Soviet Union", sovereign: "Poland" },
];
const polities = new Map(["Poland", "German Reich", "Soviet Union", "United Kingdom"].map((name) => [name.toLowerCase(), name]));
const knownPolity = (name) => polities.get(String(name).trim().toLowerCase()) || "";
const namesOf = (row) => [row.regionId, row.name, `region: ${row.name}`];

test("the lines are read as written, bullets, quotes and a ; between lines allowed", () => {
  assert.deepEqual(readOccupationSettlements("- Mazowieckie~Poland\n\"region: Lubelskie~Poland\"; Rivne~Soviet Union\nnonsense\n~Poland"), [
    { region: "Mazowieckie", to: "Poland" },
    { region: "region: Lubelskie", to: "Poland" },
    { region: "Rivne", to: "Soviet Union" },
  ]);
  assert.deepEqual(readOccupationSettlements(["Rivne~Soviet Union"]), [{ region: "Rivne", to: "Soviet Union" }]);
  assert.deepEqual(readOccupationSettlements(""), []);
});

test("each listed region goes where the answer says: back, kept or taken; anything else changes nothing", () => {
  const lines = readOccupationSettlements([
    "Mazowieckie~Poland",
    "region: Lubelskie~poland",
    "Ivano-Frankivs'k~Soviet Union",
    "Rivne~Soviet Union",
    "Mazowieckie~German Reich",
    "Bavaria~Poland",
    "Lubelskie~Atlantis",
  ].join("\n"));
  const plan = planOccupationSettlements(lines, pending, { namesOf, knownPolity });
  assert.deepEqual(plan.map(({ regionId, to, kind }) => [regionId, to, kind]), [
    ["POL.9_1", "Poland", "returned"],
    ["POL.4_1", "Poland", "returned"],
    ["UKR.7_1", "Soviet Union", "taken"],
    ["UKR.19_1", "Soviet Union", "kept"],
  ], "the first line for a region counts; an unlisted region and an unknown polity change nothing");
});

test("applied, the new holder holds and owns the land, and the map has no occupation left", () => {
  const world = {
    regionOwnershipOverrides: { "POL.9_1": "German Reich", "UKR.19_1": "Soviet Union", "DEU.1_1": "German Reich" },
    regionSovereigntyOverrides: { "POL.9_1": "Poland", "UKR.19_1": "Poland" },
    regionClaimants: { "POL.9_1": ["Poland"] },
  };
  const plan = planOccupationSettlements(readOccupationSettlements("Mazowieckie~Poland\nRivne~Soviet Union"), pending, { namesOf, knownPolity });
  const next = applyOccupationSettlements(world, plan);
  assert.equal(next.regionOwnershipOverrides["POL.9_1"], "Poland");
  assert.equal(next.regionOwnershipOverrides["UKR.19_1"], "Soviet Union");
  assert.deepEqual(next.regionSovereigntyOverrides, {});
  assert.equal(next.regionClaimants["POL.9_1"], undefined, "Poland's own claim on the land it holds again goes");
  assert.equal(next.regionOwnershipOverrides["DEU.1_1"], "German Reich", "nothing unlisted moves");
  assert.equal(world.regionOwnershipOverrides["POL.9_1"], "German Reich", "the world given is not changed");
  assert.equal(applyOccupationSettlements(world, []), world);
});
