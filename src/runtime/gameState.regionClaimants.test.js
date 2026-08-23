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
