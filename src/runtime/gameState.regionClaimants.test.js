/*! Open Historia — disputed-region (regionClaimants) tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/runtime/gameState.regionClaimants.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld } from "./gameState.js";

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
// polity that is renamed in the SAME event must land on the stable key's current
// display name, not mint a second claimant beside it.
test("regionClaims: a claimant renamed by the same event still resolves to one polity", () => {
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWithClaims(
      [{ regionId: "POL.11_1", claimantCode: "Third Reich" }],
      { polityChanges: [{ code: "Germany", name: "Third Reich" }] },
    )],
    world: emptyWorld(),
  });
  assert.deepEqual(next.regionClaimants["POL.11_1"], ["Germany"]);
});
