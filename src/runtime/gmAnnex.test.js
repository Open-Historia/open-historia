/*! Open Historia — Cheats annexation tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gmAnnex.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { applyEventImpactsToWorld } from "./gameState.js";
import { annexationImpacts, regionOwnerNow, regionsHeldBy } from "./gmAnnex.js";

// A hand-drawn map: no country codes, owners by name.
const drawn = [
  { id: "reg_1", name: "Northmark Hills", country: "Northmark", countryCode: "" },
  { id: "reg_2", name: "Northmark Coast", country: "Northmark", countryCode: "" },
  { id: "reg_3", name: "Avalon Vale", country: "Avalon", countryCode: "" },
];

test("a drawn region's owner is the name the map gives it", () => {
  assert.equal(regionOwnerNow(drawn[0], {}), "Northmark");
  assert.equal(regionOwnerNow(drawn[0], { reg_1: "Avalon" }), "Avalon");
});

test("a stock region without a baked owner falls back to its country code's name", () => {
  assert.equal(regionOwnerNow({ id: "FRA.1_1", countryCode: "FRA", country: "" }, {}), "France");
  // A scenario that bakes a different owner is read as the map shows it.
  assert.equal(regionOwnerNow({ id: "FRA.1_1", countryCode: "FRA", country: "Burgundy" }, {}), "Burgundy");
});

test("annexing a drawn country finds every region it holds", () => {
  const held = regionsHeldBy(drawn, {}, "Northmark");
  assert.deepEqual(held.map((region) => region.id), ["reg_1", "reg_2"]);
  assert.equal(held[0].name, "Northmark Hills");
});

test("regions already moved by an override count for their new owner only", () => {
  const overrides = { reg_2: "Avalon", "ghost-9": "Northmark" };
  assert.deepEqual(regionsHeldBy(drawn, overrides, "Northmark").map((region) => region.id), ["reg_1", "ghost-9"]);
  assert.deepEqual(regionsHeldBy(drawn, overrides, "Avalon").map((region) => region.id), ["reg_2", "reg_3"]);
});

test("names are exact: nothing is folded", () => {
  assert.deepEqual(regionsHeldBy(drawn, {}, "northmark"), []);
  assert.deepEqual(regionsHeldBy(drawn, {}, ""), []);
});

// ---- annexing through the event-impact seam ---------------------------------

const annex = (world, regions, owner) => applyEventImpactsToWorld({
  world,
  events: [{ id: "admin-annex-test", date: "1914-06-28", title: "Cheats annexation", impacts: annexationImpacts(world, regions, owner) }],
}).world;

const baseWorld = (extra = {}) => ({
  polityOverrides: { Northmark: { code: "Northmark", name: "Northmark" }, Avalon: { code: "Avalon", name: "Avalon" }, Wessex: { code: "Wessex", name: "Wessex" } },
  regionOwnershipOverrides: {},
  regionSovereigntyOverrides: {},
  regionClaimants: {},
  ...extra,
});

test("an annexed region changes hands and its old claims are settled", () => {
  const world = annex(
    baseWorld({ regionClaimants: { reg_1: ["Wessex"] } }),
    [{ id: "reg_1", name: "Northmark Hills", from: "Northmark" }, { id: "reg_2", name: "Northmark Coast", from: "Northmark" }],
    "Avalon",
  );
  assert.equal(world.regionOwnershipOverrides.reg_1, "Avalon");
  assert.equal(world.regionOwnershipOverrides.reg_2, "Avalon");
  assert.equal(world.regionClaimants.reg_1, undefined);
  assert.equal(world.regionSovereigntyOverrides.reg_1, undefined);
  // Settled, so the claimants a map bakes into the region stop drawing too.
  assert.ok(world.settledRegionClaims.includes("reg_1"));
  assert.ok(world.settledRegionClaims.includes("reg_2"));
});

test("a region the old owner only occupied is taken outright, not left occupied", () => {
  const world = annex(
    baseWorld({
      regionOwnershipOverrides: { reg_3: "Northmark" },
      regionSovereigntyOverrides: { reg_3: "Wessex" },
      regionClaimants: { reg_3: ["Wessex"] },
    }),
    [{ id: "reg_3", name: "Avalon Vale", from: "Northmark" }],
    "Avalon",
  );
  assert.equal(world.regionOwnershipOverrides.reg_3, "Avalon");
  assert.equal(world.regionSovereigntyOverrides.reg_3, undefined, "the new owner is the sovereign");
  assert.deepEqual(world.regionClaimants.reg_3 ?? [], [], "the old occupier is not left as a claimant");
});

test("a region already the new owner's is left alone", () => {
  const impacts = annexationImpacts(baseWorld(), [{ id: "reg_1", from: "Avalon" }], "Avalon");
  assert.deepEqual(impacts, { regionTransfers: [], regionControlOps: [] });
});
