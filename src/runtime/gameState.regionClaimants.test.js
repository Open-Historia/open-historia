/*! Open Historia — disputed-region (regionClaimants) tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.regionClaimants.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld, normalizeWorldState } from "./gameState.js";

// A stripe (Nations.jsx's disputed-region rendering) is built from
// world.regionClaimants, which nothing else ever writes — so a clean
// regionTransfer must clear it, or a resolved handover stays permanently
// striped with its old claimant forever, out of step with
// regionOwnershipOverrides (and the country panel's "Regions Owned").

const eventWithTransfer = (regionId, toCode) => ({
  date: "2025-01-01",
  title: "Territory transferred",
  description: "test",
  impacts: { regionTransfers: [{ regionId, toCode }] },
});

test("applyEventImpactsToWorld: a regionTransfer clears that region's dispute marker", () => {
  const world = { regionClaimants: { "UKR.4_1": ["Russia"] }, regionOwnershipOverrides: {} };
  const { world: next } = applyEventImpactsToWorld({ events: [eventWithTransfer("UKR.4_1", "Ukraine")], world });
  assert.equal(next.regionOwnershipOverrides["UKR.4_1"], "Ukraine");
  assert.equal("UKR.4_1" in next.regionClaimants, false);
});

test("applyEventImpactsToWorld: a transfer of an UNDISPUTED region leaves other disputes untouched", () => {
  const world = { regionClaimants: { "UKR.4_1": ["Russia"] }, regionOwnershipOverrides: {} };
  const { world: next } = applyEventImpactsToWorld({ events: [eventWithTransfer("FRA.1_1", "Germany")], world });
  assert.deepEqual(next.regionClaimants["UKR.4_1"], ["Russia"]);
});

test("applyEventImpactsToWorld: a region with no prior dispute stays undisputed after transfer", () => {
  const world = { regionClaimants: {}, regionOwnershipOverrides: {} };
  const { world: next } = applyEventImpactsToWorld({ events: [eventWithTransfer("DEU.1_1", "France")], world });
  assert.equal(next.regionOwnershipOverrides["DEU.1_1"], "France");
  assert.deepEqual(next.regionClaimants, {});
});

// --- regionClaims: raising and dropping a dispute ---------------------------
//
// Until issue #7, regionClaimants could only be SEEDED (map editor) or hand-set
// (cheats panel): the simulation had no lever to raise a dispute at all. So a
// player declaring a neighbour's province theirs had nowhere to go but a project,
// and a progress bar stood in for a border that never moved.

const eventWithClaims = (regionClaims, extra = {}) => ({
  date: "2025-01-01",
  title: "Claim asserted",
  description: "test",
  impacts: { regionClaims, ...extra },
});

const emptyWorld = () => ({ regionClaimants: {}, regionOwnershipOverrides: {} });

test("regionClaims: a claim stripes the region WITHOUT moving its owner", () => {
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWithClaims([{ regionId: "UKR.4_1", claimantCode: "Russia" }])],
    world: emptyWorld(),
  });
  assert.deepEqual(next.regionClaimants["UKR.4_1"], ["Russia"]);
  assert.equal("UKR.4_1" in next.regionOwnershipOverrides, false, "a claim must never move the border");
});

test("regionClaims: a second claimant is appended, not substituted", () => {
  const world = { regionClaimants: { "POL.11_1": ["Poland"] }, regionOwnershipOverrides: {} };
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWithClaims([{ regionId: "POL.11_1", claimantCode: "Germany" }])],
    world,
  });
  assert.deepEqual(next.regionClaimants["POL.11_1"], ["Poland", "Germany"]);
});

test("regionClaims: restating the same claim does not duplicate the stripe", () => {
  const world = { regionClaimants: { "POL.11_1": ["Germany"] }, regionOwnershipOverrides: {} };
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWithClaims([{ regionId: "POL.11_1", claimantCode: "germany" }])],
    world,
  });
  assert.deepEqual(next.regionClaimants["POL.11_1"], ["Germany"]);
});

test("regionClaims: drop removes one claimant and deletes the key at zero", () => {
  const world = { regionClaimants: { "POL.11_1": ["Germany", "Poland"] }, regionOwnershipOverrides: {} };
  const { world: once } = applyEventImpactsToWorld({
    events: [eventWithClaims([{ regionId: "POL.11_1", claimantCode: "Germany", drop: true }])],
    world,
  });
  assert.deepEqual(once.regionClaimants["POL.11_1"], ["Poland"]);

  const { world: twice } = applyEventImpactsToWorld({
    events: [eventWithClaims([{ regionId: "POL.11_1", claimantCode: "Poland", drop: true }])],
    world: once,
  });
  assert.equal("POL.11_1" in twice.regionClaimants, false, "an empty claimant list must not linger as []");
});

// Claims are applied BEFORE transfers precisely so this ends settled. The reverse
// order would leave a border that has already moved still rendering as disputed.
test("regionClaims: a region claimed and then transferred in the same event ends settled", () => {
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWithClaims(
      [{ regionId: "UKR.4_1", claimantCode: "Russia" }],
      { regionTransfers: [{ regionId: "UKR.4_1", toCode: "Russia" }] },
    )],
    world: emptyWorld(),
  });
  assert.equal(next.regionOwnershipOverrides["UKR.4_1"], "Russia");
  assert.equal("UKR.4_1" in next.regionClaimants, false);
});

// Same owner namespace as every other polity-keyed field: a claim asserted by a
// polity that is renamed in the SAME event must land on the renamed country,
// not mint a second claimant beside it.
test("regionClaims: a claimant renamed by the same event still resolves to one polity", () => {
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWithClaims(
      [{ regionId: "POL.11_1", claimantCode: "Third Reich" }],
      { polityChanges: [{ code: "Germany", name: "Third Reich" }] },
    )],
    world: emptyWorld(),
  });
  assert.deepEqual(next.regionClaimants["POL.11_1"], ["Third Reich"]);
  assert.equal("Germany" in next.polityOverrides, false, "the rename re-keyed the country");
});

// --- An ended dispute stays ended --------------------------------------------
//
// The claimant list is sparse, so a dispute that ends leaves no row, and the map
// draws the claimants a region's geojson feature bakes in wherever the world has
// none (the built-in map bakes 109). settledRegionClaims records each ended one,
// so the map knows the world has the say there.

const clearContest = (regionId, claimantCode) => ({
  date: "2025-01-01",
  title: "Ceasefire",
  description: "test",
  impacts: { regionControlOps: [{ op: "clear_contest", regionId, claimantCode }] },
});

test("a dispute that ends is recorded as settled: a claim dropped, a contest cleared, a clean hand-over", () => {
  const disputed = () => ({ regionClaimants: { "UKR.4_1": ["Russia"] }, regionOwnershipOverrides: { "UKR.4_1": "Ukraine" } });
  const dropped = applyEventImpactsToWorld({ events: [eventWithClaims([{ regionId: "UKR.4_1", claimantCode: "Russia", drop: true }])], world: disputed() }).world;
  const cleared = applyEventImpactsToWorld({ events: [clearContest("UKR.4_1", "Russia")], world: disputed() }).world;
  const handedOver = applyEventImpactsToWorld({ events: [eventWithTransfer("UKR.4_1", "Ukraine")], world: disputed() }).world;
  for (const [how, next] of [["dropped", dropped], ["cleared", cleared], ["handed over", handedOver]]) {
    assert.equal("UKR.4_1" in next.regionClaimants, false, `${how}: the row goes, as it always has`);
    assert.deepEqual(next.settledRegionClaims, ["UKR.4_1"], `${how}: and the region is settled`);
  }
});

test("a clean hand-over settles a dispute only the map declared, and leaves other disputes alone", () => {
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWithTransfer("KAS.1_1", "India")],
    world: { regionClaimants: { "UKR.4_1": ["Russia"] }, regionOwnershipOverrides: {} },
  });
  assert.deepEqual(next.settledRegionClaims, ["KAS.1_1"]);
  assert.deepEqual(next.regionClaimants, { "UKR.4_1": ["Russia"] });
});

test("a dispute that goes on is not settled: one claimant dropped of two", () => {
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWithClaims([{ regionId: "UKR.4_1", claimantCode: "Russia", drop: true }])],
    world: { regionClaimants: { "UKR.4_1": ["Russia", "Belarus"] }, regionOwnershipOverrides: { "UKR.4_1": "Ukraine" } },
  });
  assert.deepEqual(next.regionClaimants["UKR.4_1"], ["Belarus"]);
  assert.deepEqual(next.settledRegionClaims, []);
});

test("a settled region claimed again leaves the list, and a save's list is kept tidy", () => {
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWithClaims([{ regionId: "UKR.4_1", claimantCode: "Russia" }])],
    world: { regionClaimants: {}, settledRegionClaims: ["UKR.4_1", "UKR.5_1"], regionOwnershipOverrides: { "UKR.4_1": "Ukraine" } },
  });
  assert.deepEqual(next.regionClaimants["UKR.4_1"], ["Russia"]);
  assert.deepEqual(next.settledRegionClaims, ["UKR.5_1"]);

  const tidy = normalizeWorldState({ regionClaimants: { a: ["X"] }, settledRegionClaims: ["a", "b", "b", " ", "c"] });
  assert.deepEqual(tidy.settledRegionClaims, ["b", "c"], "unique, no blanks, and never a region disputed again");
  assert.deepEqual(normalizeWorldState({}).settledRegionClaims, [], "a save from before has none");
});
